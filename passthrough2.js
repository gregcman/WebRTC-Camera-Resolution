import {WebXRButton} from './js/util/webxr-button.js';
import {Scene} from './js/render/scenes/scene.js';
import {Renderer, createWebGLContext} from './js/render/core/renderer.js';
import {UrlTexture} from './js/render/core/texture.js';
import {ButtonNode} from './js/render/nodes/button.js';
import {Gltf2Node} from './js/render/nodes/gltf2.js';
import {VideoNode} from './js/render/nodes/video.js';
import {InlineViewerHelper} from './js/util/inline-viewer-helper.js';
import {QueryArgs} from './js/util/query-args.js';

// If requested, use the polyfill to provide support for mobile devices
// and devices which only support WebVR.
import WebXRPolyfill from './js/third-party/webxr-polyfill/build/webxr-polyfill.module.js';
if (QueryArgs.getBool('usePolyfill', true)) {
    let polyfill = new WebXRPolyfill();
}

let autoplayCheckbox = document.getElementById('autoplayVideo');

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
scene.addNode(new Gltf2Node({url: 'media/gltf/home-theater/home-theater.gltf'}));
scene.enableStats(false);

let video = document.querySelector('#video');
video.loop = true;
//video.src = 'media/video/bbb-sunflower-540p2-1min.webm';

let videoNode = new VideoNode({
    video: video,
    displayMode: 'stereoTopBottom'
});

// When the video is clicked we'll pause it if it's playing.
videoNode.onSelect(() => {
    if (!video.paused) {
        playButton.visible = true;
        video.pause();
    } else {
        playButton.visible = false;
        video.play();
    }
});
videoNode.selectable = true;

// Move back to the position of the in-room screen and size to cover it.
// Values determined experimentally and with many refreshes.
videoNode.translation = [0.025, 0.275, -4.4];
videoNode.scale = [2.1, 1.1, 1.0];
scene.addNode(videoNode);

video.addEventListener('loadeddata', () => {
    // Once the video has loaded up adjust the aspect ratio of the "screen"
    // to fit the video's native shape.
    let aspect = videoNode.aspectRatio;
    if (aspect < 2.0) {
        videoNode.scale = [aspect * 1.1, 1.1, 1.0];
    } else {
        videoNode.scale = [2.1, 2.1 / aspect, 1.0];
    }
});

// Add a button to the scene to play/pause the movie.
let playTexture = new UrlTexture('media/textures/play-button.png');

// Create a button that plays the video when clicked.
let playButton = new ButtonNode(playTexture, () => {
    // Play the video and hide the button.
    if (video.paused) {
        playButton.visible = false;
        video.play();
    }
});
// Move the play button to the center of the screen and make it much
// bigger.
playButton.translation = [0.025, 0.275, -4.2];
playButton.scale = [5.0, 5.0, 5.0];
scene.addNode(playButton);

function initXR() {
    xrButton = new WebXRButton({
        onRequestSession: onRequestSession,
        onEndSession: onEndSession
    });
    document.querySelector('header').appendChild(xrButton.domElement);

    
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
	    xrButton.enabled = supported;
        });

        //navigator.xr.requestSession('inline').then(onSessionStarted);
    }
    
}

function initGL() {
    if (gl)
        return;

    gl = createWebGLContext({
        xrCompatible: true
    });
    document.body.appendChild(gl.canvas);

    function onResize() {
        gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
        gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', onResize);
    onResize();

    renderer = new Renderer(gl);
    scene.setRenderer(renderer);
}

function onRequestSession() {
    let autoplay = autoplayCheckbox.checked;

    let pending;

    if (autoplay) {
        // If we want the video to autoplay when the session has fully started
        // (which may be several seconds after the original requestSession
        // call due to clicking through consent prompts or similar) then we
        // need to start the video within a user activation event first
        // (which this function is.) Once it's been started successfully we
        // pause it, at which point we can resume it pretty much whenever we'd
        // like.
        pending = video.play().then(() => {
            video.pause();
        });
    }

    return navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor']
    }).then((session) => {
        xrButton.setSession(session);
        session.isImmersive = true;
        onSessionStarted(session);

        if (autoplay) {
            pending.then(() => {
		video.play();
            });
        }
    });
}

function onSessionStarted(session) {
    session.addEventListener('end', onSessionEnded);
    session.addEventListener('select', (ev) => {
        let refSpace = ev.frame.session.isImmersive ?
            xrImmersiveRefSpace :
            inlineViewerHelper.referenceSpace;
        scene.handleSelect(ev.inputSource, ev.frame, refSpace);
    });

    initGL();
    scene.inputRenderer.useProfileControllerMeshes(session);

    let glLayer = new XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: glLayer });

    // In this case we're going to use an 'local' frame of reference
    // because we want to users head to appear in the right place relative
    // to the center chair, as if they're sitting in it, rather than
    // somewhere in the room relative to the floor.
    let refSpaceType = session.isImmersive ? 'local' : 'viewer';
    session.requestReferenceSpace(refSpaceType).then((refSpace) => {
        if (session.isImmersive) {
            xrImmersiveRefSpace = refSpace;
        } else {
            inlineViewerHelper = new InlineViewerHelper(gl.canvas, refSpace);
        }

        session.requestAnimationFrame(onXRFrame);
    });
}

function onEndSession(session) {
    session.end();
}

function onSessionEnded(event) {
    if (event.session.isImmersive) {
        xrButton.setSession(null);
        video.pause();
    }
}

function onXRFrame(t, frame) {
    let session = frame.session;
    let refSpace = session.isImmersive ?
        xrImmersiveRefSpace :
        inlineViewerHelper.referenceSpace;
    let pose = frame.getViewerPose(refSpace);

    scene.startFrame();

    session.requestAnimationFrame(onXRFrame);

    scene.updateInputSources(frame, refSpace);

    scene.drawXRFrame(frame, pose);

    scene.endFrame();
}

// Start the XR application.
initXR();

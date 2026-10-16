// Synthetic devices and landmarks are installed by CDP only in the browser test.
exports.injection = `(() => {
  window.__visionRequests = [];
  window.__fixtureYaw = 0;
  window.__fixtureFaceCount = 1;
  window.__cameraStops = 0;
  window.__cameraRequests = [];
  window.__cameraConfigurations = [];
  window.__activeCameras = 0;
  window.__cameraCreated = 0;
  window.__fixtureInFlight = 0;
  window.__fixtureMaxInFlight = 0;
  window.__fixtureMarker = false;
  window.__fixtureDetectionCount = 0;
  window.__fixtureDetectionPending = false;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options = {}) => {
    if (options.body && String(url).includes('/api/')) window.__visionRequests.push({url: String(url), body: JSON.parse(options.body)});
    return originalFetch(url, options);
  };
  window.__fixtureFace = () => {
    const points = Array.from({length:478}, () => ({x:.5,y:.5,z:0}));
    const set = (i,x,y) => points[i] = {x:x/1280,y:y/720,z:0};
    [[10,640,165],[9,640,280],[152,640,555],[234,430,350],[454,850,350],
     [103,520,220],[332,760,220],[172,490,450],[397,790,450],
     [105,545,290],[334,735,290],[2,640,385],[1,640,350],[168,640,295],
     [6,640,300],[197,640,305],[195,640,310],[5,640,315],
     [33,555,315],[133,605,315],[362,675,315],[263,725,315],
     [98,610,385],[327,670,385],[102,610,385],[331,670,385],[61,580,430],[291,700,430],
     [0,640,424],[13,640,435],[17,640,450],[14,640,440],
     [50,575,400],[101,560,410],[118,570,420],[205,580,425],[206,700,420],
     [216,710,410],[280,705,400],[330,700,410],[347,690,425]].forEach(([i,x,y]) => set(i,x,y));
    const angle = window.__fixtureYaw * Math.PI / 180;
    for (const point of points) { const x = point.x - .5; point.x = .5 + x * Math.cos(angle); point.z = -x * Math.sin(angle); }
    return points;
  };
  const devices = [{kind:'videoinput',deviceId:'fixture-front',label:'Fixture webcam'}, {kind:'videoinput',deviceId:'fixture-usb',label:'iPhone fixture / USB camera'}, {kind:'videoinput',deviceId:'fixture-rear',label:'Fixture back camera'}];
  const mediaDevices = new EventTarget();
  mediaDevices.enumerateDevices = async () => devices;
  mediaDevices.getUserMedia = async constraints => {
    window.__cameraRequests.push(constraints);
    if (window.__cameraFailure) throw new DOMException('Camera fixture unavailable', window.__cameraFailure);
    if(window.__fixtureOpenDelay)await new Promise(resolve=>setTimeout(resolve,window.__fixtureOpenDelay));
    const mode=constraints.video.facingMode?.exact || constraints.video.facingMode?.ideal || 'user';
    const chosen=constraints.video.deviceId?.exact || (mode==='environment'?'fixture-rear':'fixture-front');
    const canvas = document.createElement('canvas'); canvas.width=constraints.video.width?.ideal || 640; canvas.height=constraints.video.height?.ideal || 480;
    const context=canvas.getContext('2d');
    let marker=20;
    const paint = () => {
      if(window.__fixturePaused)return;
      const width=canvas.width,height=canvas.height,gradient=context.createLinearGradient(0,0,width,height);
      gradient.addColorStop(0,'#444');gradient.addColorStop(1,'#ddd');context.fillStyle=gradient;context.fillRect(0,0,width,height);
      if(!window.__fixtureBlur){const cell=Math.max(4,Math.round(width/64));for(let y=0;y<height;y+=cell)for(let x=0;x<width;x+=cell){context.fillStyle=((Math.floor(x/cell)+Math.floor(y/cell))%2)?'#ffffff24':'#00000024';context.fillRect(x,y,cell,cell);}}
      if(window.__fixtureMarker){marker=(marker+70)%240;context.fillStyle='rgb('+marker+',0,0)';context.fillRect(0,0,72,72);}
    };
    paint(); const interval = setInterval(paint,50);
    const stream=canvas.captureStream(20), track=stream.getVideoTracks()[0];
    const settings=track.getSettings.bind(track), stop=track.stop.bind(track);let stopped=false,currentConstraints=constraints.video;
    window.__activeCameras++;window.__cameraCreated++;
    track.getSettings=()=>({...settings(),width:canvas.width,height:canvas.height,frameRate:currentConstraints.frameRate?.ideal||20,deviceId:chosen,facingMode:chosen==='fixture-rear'?'environment':'user'});
    track.getCapabilities=()=>({width:{min:640,max:1920},height:{min:480,max:1080},frameRate:{min:10,max:30},focusMode:['continuous']});
    track.getConstraints=()=>currentConstraints;
    track.applyConstraints=async config=>{window.__cameraConfigurations.push(config);currentConstraints=config;canvas.width=config.width?.ideal||canvas.width;canvas.height=config.height?.ideal||canvas.height;paint();};
    track.stop=()=>{if(stopped)return;stopped=true;window.__activeCameras--;window.__cameraStops++;clearInterval(interval);stop();};
    return stream;
  };
  Object.defineProperty(navigator,'mediaDevices',{value:mediaDevices, configurable:true});
})();`;

exports.model = `export async function createLandmarker(mode='VIDEO') {
  if(mode==='IMAGE' && window.__fixtureImageDelay) await new Promise(resolve=>setTimeout(resolve,window.__fixtureImageDelay));
  const detect = source => ({faceLandmarks:Array.from({length:source.width < (window.__fixtureMinInputWidth || 0) ? 0 : window.__fixtureFaceCount},()=>{
    const points=window.__fixtureFace();
    if(window.__fixtureInvalidFace)points[200].x=NaN;
    if(window.__fixtureMarker)points[477].z=source.getContext('2d').getImageData(8,8,1,1).data[0]/255;
    return points;
  })});
  const detectForVideo = async source => {
    window.__fixtureLastInput={width:source.width,height:source.height};window.__fixtureInFlight++;window.__fixtureMaxInFlight=Math.max(window.__fixtureMaxInFlight,window.__fixtureInFlight);
    const result=detect(source);window.__fixtureDetectionCount++;window.__fixtureDetectionPending=true;
    await new Promise(resolve=>setTimeout(resolve,window.__fixtureDelay||0));
    window.__fixtureInFlight--;window.__fixtureDetectionPending=false;return result;
  };
  return {detect,detectForVideo,close(){}};
}`;

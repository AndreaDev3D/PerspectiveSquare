/* ========= Utilities ========= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lerp(a,b,t){ return a + (b-a)*t; }

/* ========= DOM refs ========= */
const fileInput   = document.getElementById('file');
const outSize     = document.getElementById('outSize');
const outSizeVal  = document.getElementById('outSizeVal');
const maintainAspect = document.getElementById('maintainAspect');
const resetBtn    = document.getElementById('resetBtn');
const flipBtn     = document.getElementById('flipBtn');
const liveRender  = document.getElementById('liveRender');

const srcCanvas = document.getElementById('srcCanvas');
const dstCanvas = document.getElementById('dstCanvas');
const srcCtx    = srcCanvas.getContext('2d');
const dstCtx    = dstCanvas.getContext('2d', { willReadFrequently: true });

const hudL = document.getElementById('hudL');
const hudR = document.getElementById('hudR');

let img = new Image();
let imgBitmap = null; // for crisp draws
let srcImageData = null; // cached image data for sampling
let handles = []; // 4 points: [{x,y}, ...] clockwise
let dragging = { active:false, idx:-1, ox:0, oy:0 };
let devicePixelRatioCached = Math.max(1, window.devicePixelRatio || 1);

/* ========= Load image ========= */
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const blob = await file.arrayBuffer();
  const objURL = URL.createObjectURL(new Blob([blob]));
  await loadImage(url);
  URL.revokeObjectURL(objURL);
});

async function loadImage(url) {
  img = new Image();
  img.onload = async () => {
    imgBitmap = await createImageBitmap(img);
    fitCanvases();
    initHandles();
    drawSource();
    cacheSourceImageData();
    renderOutput();
    hudL.textContent = `Image: ${img.width}×${img.height}`;
  };
  img.onerror = () => { hudL.textContent = 'Failed to load image'; };
  img.src = url;
}

/* ========= Canvas sizing & drawing ========= */
function fitCanvases() {
  // Fit source canvas to the left pane with device-pixel scaling
  const rect = document.getElementById('leftPane').getBoundingClientRect();
  const maxW = rect.width, maxH = rect.height;
  if (!imgBitmap) return;

  const scale = Math.min(maxW / imgBitmap.width, maxH / imgBitmap.height, 1);
  const wCSS = Math.floor(imgBitmap.width * scale);
  const hCSS = Math.floor(imgBitmap.height * scale);

  // handle DPR
  const dpr = devicePixelRatioCached;
  srcCanvas.style.width = wCSS + 'px';
  srcCanvas.style.height = hCSS + 'px';
  srcCanvas.width = Math.max(1, Math.floor(wCSS * dpr));
  srcCanvas.height = Math.max(1, Math.floor(hCSS * dpr));

  // draw image scaled for DPR
  srcCtx.setTransform(1,0,0,1,0,0);
  srcCtx.clearRect(0,0,srcCanvas.width, srcCanvas.height);
  srcCtx.imageSmoothingEnabled = true;
  srcCtx.drawImage(
    imgBitmap,
    0,0,imgBitmap.width,imgBitmap.height,
    0,0,srcCanvas.width,srcCanvas.height
  );
}

function initHandles() {
  // initial corners at the image boundaries (clockwise starting top-left)
  handles = [
    { x: 10, y: 10 }, // will be reset after knowing canvas size
    { x: srcCanvas.width - 10, y: 10 },
    { x: srcCanvas.width - 10, y: srcCanvas.height - 10 },
    { x: 10, y: srcCanvas.height - 10 }
  ];
}

function drawSource() {
  if (!imgBitmap) return;
  // redraw image first
  srcCtx.setTransform(1,0,0,1,0,0);
  srcCtx.clearRect(0,0,srcCanvas.width, srcCanvas.height);
  srcCtx.drawImage(
    imgBitmap, 0,0,imgBitmap.width,imgBitmap.height,
    0,0,srcCanvas.width,srcCanvas.height
  );

  // Draw polygon & handles
  srcCtx.lineWidth = 2;
  srcCtx.strokeStyle = 'rgba(105,179,255,0.9)';
  srcCtx.fillStyle = 'rgba(105,179,255,0.12)';

  srcCtx.beginPath();
  srcCtx.moveTo(handles[0].x, handles[0].y);
  for (let i=1;i<4;i++) srcCtx.lineTo(handles[i].x, handles[i].y);
  srcCtx.closePath();
  srcCtx.fill();
  srcCtx.stroke();

  // draw handles
  for (let i=0;i<4;i++){
    drawHandle(handles[i].x, handles[i].y, i);
  }
}

function drawHandle(x,y,i){
  const r = 8 * Math.sqrt(devicePixelRatioCached);
  srcCtx.beginPath();
  srcCtx.arc(x,y,r,0,Math.PI*2);
  srcCtx.fillStyle = 'rgba(105,179,255,1)';
  srcCtx.fill();
  srcCtx.lineWidth = 2;
  srcCtx.strokeStyle = 'rgba(0,0,0,0.6)';
  srcCtx.stroke();

  // small label
  const lab = ['TL','TR','BR','BL'][i];
  srcCtx.font = `${10 * devicePixelRatioCached}px system-ui, sans-serif`;
  srcCtx.fillStyle = 'rgba(0,0,0,0.8)';
  srcCtx.fillText(lab, x + 10*devicePixelRatioCached, y - 10*devicePixelRatioCached);
}

/* ========= Interaction (mouse/touch) ========= */
function pickHandle(mx,my){
  const r = 14 * Math.sqrt(devicePixelRatioCached);
  for (let i=0;i<4;i++){
    const dx = handles[i].x - mx, dy = handles[i].y - my;
    if (dx*dx + dy*dy <= r*r) return i;
  }
  return -1;
}

function canvasToLocal(evt) {
  const rect = srcCanvas.getBoundingClientRect();
  const dpr = devicePixelRatioCached;
  const x = (evt.clientX - rect.left) * dpr;
  const y = (evt.clientY - rect.top) * dpr;
  return {x,y};
}

srcCanvas.addEventListener('mousedown', (e)=>{
  if (!imgBitmap) return;
  const {x,y} = canvasToLocal(e);
  const idx = pickHandle(x,y);
  if (idx>=0){
    dragging.active = true;
    dragging.idx = idx;
  }
});
window.addEventListener('mousemove', (e)=>{
  if (!dragging.active) return;
  const {x,y} = canvasToLocal(e);
  handles[dragging.idx].x = clamp(x, 0, srcCanvas.width);
  handles[dragging.idx].y = clamp(y, 0, srcCanvas.height);
  drawSource();
  if (liveRender.checked) {
    // Update output size if aspect ratio is maintained
    if (maintainAspect.checked) {
      setOutputSize(+outSize.value);
    } else {
      renderOutput();
    }
  }
});
window.addEventListener('mouseup', ()=>{
  if (dragging.active){
    dragging.active=false;
    if (maintainAspect.checked) {
      setOutputSize(+outSize.value);
    } else {
      renderOutput();
    }
  }
});

/* Touch */
srcCanvas.addEventListener('touchstart', (e)=>{
  if (!imgBitmap) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  const {x,y} = canvasToLocal(t);
  const idx = pickHandle(x,y);
  if (idx>=0){
    dragging.active = true;
    dragging.idx = idx;
  }
},{passive:false});
srcCanvas.addEventListener('touchmove', (e)=>{
  if (!dragging.active) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  const {x,y} = canvasToLocal(t);
  handles[dragging.idx].x = clamp(x, 0, srcCanvas.width);
  handles[dragging.idx].y = clamp(y, 0, srcCanvas.height);
  drawSource();
  if (liveRender.checked) {
    // Update output size if aspect ratio is maintained
    if (maintainAspect.checked) {
      setOutputSize(+outSize.value);
    } else {
      renderOutput();
    }
  }
},{passive:false});
srcCanvas.addEventListener('touchend', ()=>{
  if (dragging.active){ 
    dragging.active=false; 
    if (maintainAspect.checked) {
      setOutputSize(+outSize.value);
    } else {
      renderOutput();
    }
  }
});

/* ========= Output size control ========= */
function calculateSelectedAreaAspectRatio() {
  if (handles.length < 4) return 1; // default to square if no handles
  
  // Calculate the width and height of the selected area
  const width = Math.abs(handles[1].x - handles[0].x); // TR - TL
  const height = Math.abs(handles[3].y - handles[0].y); // BL - TL
  
  return width / height;
}

function setOutputSize(px){
  const baseSize = Math.max(64, Math.floor(px));
  const dpr = devicePixelRatioCached;
  
  let outputWidth, outputHeight;
  
  if (maintainAspect.checked && handles.length >= 4) {
    const aspectRatio = calculateSelectedAreaAspectRatio();
    if (aspectRatio > 1) {
      // Wider than tall
      outputWidth = baseSize;
      outputHeight = Math.floor(baseSize / aspectRatio);
    } else {
      // Taller than wide
      outputHeight = baseSize;
      outputWidth = Math.floor(baseSize * aspectRatio);
    }
  } else {
    // Default to square
    outputWidth = outputHeight = baseSize;
  }
  
  dstCanvas.style.width  = outputWidth + 'px';
  dstCanvas.style.height = outputHeight + 'px';
  dstCanvas.width  = outputWidth * dpr;
  dstCanvas.height = outputHeight * dpr;
  hudR.textContent = `Output: ${outputWidth}×${outputHeight}`;
  renderOutput();
}
outSize.addEventListener('input', ()=>{
  // Show preview of what the output size will be
  const baseSize = +outSize.value;
  if (maintainAspect.checked && handles.length >= 4) {
    const aspectRatio = calculateSelectedAreaAspectRatio();
    let width, height;
    if (aspectRatio > 1) {
      width = baseSize;
      height = Math.floor(baseSize / aspectRatio);
    } else {
      height = baseSize;
      width = Math.floor(baseSize * aspectRatio);
    }
    outSizeVal.textContent = `${width}×${height}`;
  } else {
    outSizeVal.textContent = `${baseSize}×${baseSize}`;
  }
});
outSize.addEventListener('change', ()=> setOutputSize(+outSize.value));

// Update output when aspect ratio checkbox is toggled
maintainAspect.addEventListener('change', ()=>{
  if (imgBitmap) {
    setOutputSize(+outSize.value);
  }
});

resetBtn.addEventListener('click', ()=>{
  if (!imgBitmap) return;
  initHandles();
  drawSource();
  renderOutput();
});
flipBtn.addEventListener('click', ()=>{
  if (!imgBitmap) return;
  // Swap winding between CW and CCW (swap last two points)
  [handles[2], handles[3]] = [handles[3], handles[2]];
  drawSource();
  renderOutput();
});

/* ========= Homography math =========
   Compute H that maps (u,v) in dst square [0..W]x[0..H] -> src quad (x,y).
   Then for each destination pixel we apply H to sample source.
*/
function computeHomography(srcPts, dstPts){
  // srcPts: [{x,y}...], dstPts: square corners in same order
  // Build 8x8 system for 8 unknowns (h11..h32), last h33 = 1
  const A = new Float64Array(8*8).fill(0);
  const b = new Float64Array(8).fill(0);

  for (let i=0;i<4;i++){
    const xs = srcPts[i].x, ys = srcPts[i].y;
    const xd = dstPts[i].x, yd = dstPts[i].y;

    const r1 = i*2, r2 = i*2+1;
    // Row r1
    A[r1*8 + 0] = xd;
    A[r1*8 + 1] = yd;
    A[r1*8 + 2] = 1;
    A[r1*8 + 3] = 0;
    A[r1*8 + 4] = 0;
    A[r1*8 + 5] = 0;
    A[r1*8 + 6] = -xd*xs;
    A[r1*8 + 7] = -yd*xs;
    b[r1] = xs;

    // Row r2
    A[r2*8 + 0] = 0;
    A[r2*8 + 1] = 0;
    A[r2*8 + 2] = 0;
    A[r2*8 + 3] = xd;
    A[r2*8 + 4] = yd;
    A[r2*8 + 5] = 1;
    A[r2*8 + 6] = -xd*ys;
    A[r2*8 + 7] = -yd*ys;
    b[r2] = ys;
  }

  const h = gaussianSolve(A, b); // length 8
  // H maps dst -> src
  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1
  ];
}

function gaussianSolve(A, b){
  // Simple Gauss elimination with partial pivot (8x8)
  const n = 8;
  // Build augmented
  const M = Array.from({length:n}, (_,i)=>[
    A[i*8+0],A[i*8+1],A[i*8+2],A[i*8+3],A[i*8+4],A[i*8+5],A[i*8+6],A[i*8+7], b[i]
  ]);

  for (let col=0; col<n; col++){
    // pivot
    let piv = col;
    for (let r=col+1; r<n; r++){
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('Singular matrix');
    // swap
    if (piv !== col){ const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp; }
    // normalize
    const div = M[col][col];
    for (let c=col; c<=n; c++) M[col][c] /= div;
    // eliminate
    for (let r=0; r<n; r++){
      if (r===col) continue;
      const f = M[r][col];
      for (let c=col; c<=n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

function applyH(H, x, y){
  const X = H[0]*x + H[1]*y + H[2];
  const Y = H[3]*x + H[4]*y + H[5];
  const W = H[6]*x + H[7]*y + 1;
  return { x: X/W, y: Y/W };
}

/* ========= Sampling ========= */
function cacheSourceImageData(){
  if (!imgBitmap) return;
  // Create a 1:1 pixel buffer matching srcCanvas current draw
  srcImageData = srcCtx.getImageData(0,0,srcCanvas.width, srcCanvas.height);
}

function bilinearSample(imgData, x, y){
  // x,y are in source canvas pixel coords
  const {width, height, data} = imgData;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = clamp(x0+1, 0, width-1);
  const y1 = clamp(y0+1, 0, height-1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);

  const idx = (xx,yy) => ((yy*width + xx) << 2);

  const i00 = idx(clamp(x0,0,width-1), clamp(y0,0,height-1));
  const i10 = idx(x1, y0);
  const i01 = idx(x0, y1);
  const i11 = idx(x1, y1);

  const r = lerp(lerp(data[i00], data[i10], tx), lerp(data[i01], data[i11], tx), ty);
  const g = lerp(lerp(data[i00+1], data[i10+1], tx), lerp(data[i01+1], data[i11+1], tx), ty);
  const b = lerp(lerp(data[i00+2], data[i10+2], tx), lerp(data[i01+2], data[i11+2], tx), ty);
  const a = lerp(lerp(data[i00+3], data[i10+3], tx), lerp(data[i01+3], data[i11+3], tx), ty);
  return [r,g,b,a];
}

/* ========= Rendering the output ========= */
function renderOutput(){
  if (!imgBitmap || !srcImageData) return;

  // Destination is a square [0..W]x[0..H] in device pixels
  const W = dstCanvas.width, H = dstCanvas.height;

  // Dst square corners in clockwise: TL, TR, BR, BL in dst space
  const dstSq = [
    { x: 0, y: 0 },
    { x: W-1, y: 0 },
    { x: W-1, y: H-1 },
    { x: 0, y: H-1 }
  ];

  // Source quad: current handles (already in source-canvas pixel space)
  const srcQuad = handles.map(p => ({x:p.x, y:p.y}));

  // Compute H: maps dst -> src
  let Hmat;
  try {
    Hmat = computeHomography(srcQuad, dstSq);
  } catch (e) {
    console.warn(e);
    return;
  }

  // Prepare output buffer
  const out = dstCtx.createImageData(W, H);
  const outD = out.data;

  // Sample for each pixel in destination
  // Loop y outer for better memory locality
  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      const {x:sx, y:sy} = applyH(Hmat, x, y);

      // If outside, put transparent or edge-clamped
      if (sx < 0 || sy < 0 || sx >= srcCanvas.width || sy >= srcCanvas.height){
        const oi = ((y*W + x) << 2);
        outD[oi]   = 0; outD[oi+1] = 0; outD[oi+2] = 0; outD[oi+3] = 0;
        continue;
      }
      const [r,g,b,a] = bilinearSample(srcImageData, sx, sy);
      const oi = ((y*W + x) << 2);
      outD[oi]   = r;
      outD[oi+1] = g;
      outD[oi+2] = b;
      outD[oi+3] = a;
    }
  }

  dstCtx.putImageData(out, 0, 0);
}

/* ========= Resize handling ========= */
window.addEventListener('resize', ()=>{
  if (!imgBitmap) return;
  // We want the quad points to track proportionally if the canvas size changes.
  // Compute normalized points before resize, then re-apply.
  const oldW = srcCanvas.width, oldH = srcCanvas.height;
  const norm = handles.map(p => ({ x: p.x/oldW, y: p.y/oldH }));

  fitCanvases();
  handles = norm.map(p => ({ x: p.x * srcCanvas.width, y: p.y * srcCanvas.height }));
  drawSource();
  cacheSourceImageData();
  renderOutput();
});

/* ========= Init ========= */
(function init(){
  outSizeVal.textContent = `${outSize.value}×${outSize.value}`;
  setOutputSize(+outSize.value);
  hudL.textContent = 'Upload an image to begin';
})();

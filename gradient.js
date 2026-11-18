// WebGL renderer: bicubic-sampled OKLab color grid + simplex-noise domain warp + grain.
(function () {
  const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;uv.y=1.-uv.y;gl_Position=vec4(p,0.,1.);}`;
  const FS = `precision highp float;
varying vec2 uv;
uniform sampler2D grid;      // float-ish RGBA8: OKLab packed (L, a*2+.5, b*2+.5)
uniform vec2 gridSize;
uniform float warp, smoothness, grain, seed, aspect;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;vec3 h=abs(x)-.5;vec3 ox=floor(x+.5);vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
vec3 fetch(vec2 ij){
  ij=clamp(ij,vec2(0.),gridSize-1.);
  vec3 t=texture2D(grid,(ij+.5)/gridSize).rgb;
  return vec3(t.r,(t.g-.5)*.8,(t.b-.5)*.8);
}
// Catmull-Rom cubic weights
vec4 cw(float t){
  float t2=t*t,t3=t2*t;
  return vec4(-.5*t3+t2-.5*t,1.5*t3-2.5*t2+1.,-1.5*t3+2.*t2+.5*t,.5*t3-.5*t2);
}
vec3 bicubic(vec2 p){
  vec2 q=p*gridSize-.5;vec2 f=fract(q);vec2 i=floor(q);
  vec4 wx=cw(f.x),wy=cw(f.y);vec3 acc=vec3(0.);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    acc+=fetch(i+vec2(float(x)-1.,float(y)-1.))*wx[x]*wy[y];
  }
  return acc;
}
vec3 oklab2rgb(vec3 c){
  float l=c.x+.3963377774*c.y+.2158037573*c.z;
  float m=c.x-.1055613458*c.y-.0638541728*c.z;
  float s=c.x-.0894841775*c.y-1.2914855480*c.z;
  l=l*l*l;m=m*m*m;s=s*s*s;
  vec3 lin=vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,
               -1.2684380046*l+2.6097574011*m-.3413193965*s,
               -.0041960863*l-.7034186147*m+1.7076147010*s);
  lin=clamp(lin,0.,1.);
  return mix(lin*12.92,1.055*pow(lin,vec3(1./2.4))-.055,step(.0031308,lin));
}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 p=uv;
  vec2 s=vec2(aspect,1.);
  // layered domain warp for fluid shapes
  vec2 q=p*s*0.9+seed;
  vec2 w1=vec2(snoise(q),snoise(q+7.3));
  vec2 w2=vec2(snoise(q*1.7+w1*.5+3.1),snoise(q*1.7-w1*.5+9.7));
  vec2 d=(w1*.85+w2*.15)*warp*.22;
  // stronger horizontal drift than vertical keeps the vertical tonal structure
  p+=d*vec2(1.2,.8);
  p=clamp(p,0.,1.);
  vec3 c=bicubic(p);
  // extra smoothing: average a few softly offset samples
  float r=smoothness*.12;
  if(r>0.){
    vec3 a=c*2.;float wsum=2.;
    for(int i=0;i<8;i++){
      float ang=float(i)*.785398;
      vec2 o=vec2(cos(ang)*.7,sin(ang))*r;
      float w=i<4?1.:.6;
      a+=bicubic(clamp(p+o,0.,1.))*w;wsum+=w;
    }
    c=a/wsum;
  }
  vec3 rgb=oklab2rgb(c);
  float n=hash(gl_FragCoord.xy+seed)-.5;
  rgb+=n*(grain*.06+.004);
  gl_FragColor=vec4(rgb,1.);
}`;

  function sh(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function Renderer(canvas) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL unavailable');
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    const U = n => gl.getUniformLocation(pr, n);
    let gw = 1, gh = 1;

    // data: Float32Array of OKLab triples, w*h cells
    this.setGrid = (data, w, h) => {
      gw = w; gh = h;
      const px = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        px[i*4]   = Math.round(Math.min(1, Math.max(0, data[i*3])) * 255);
        px[i*4+1] = Math.round(Math.min(1, Math.max(0, data[i*3+1] / .8 + .5)) * 255);
        px[i*4+2] = Math.round(Math.min(1, Math.max(0, data[i*3+2] / .8 + .5)) * 255);
        px[i*4+3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    // opts: {width,height,warp(0-1),smooth(0-1),grain(0-1),seed}
    this.render = o => {
      canvas.width = o.width; canvas.height = o.height;
      gl.viewport(0, 0, o.width, o.height);
      gl.uniform1i(U('grid'), 0);
      gl.uniform2f(U('gridSize'), gw, gh);
      gl.uniform1f(U('warp'), o.warp);
      gl.uniform1f(U('smoothness'), o.smooth);
      gl.uniform1f(U('grain'), o.grain);
      gl.uniform1f(U('seed'), o.seed);
      gl.uniform1f(U('aspect'), o.width / o.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }
  window.GradientRenderer = Renderer;
})();

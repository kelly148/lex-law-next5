/**
 * shaders.ts — WHEREAS-POLISH-1 GLSL fragment-shader BODIES (spec §5), with the §3.1 reconciled brand
 * constants applied via the WA token strings. The standard uniforms (u_res/u_time/u_intensity/u_motion/
 * u_mouse) are declared centrally by ShaderCanvas, so the `uniform` lines are stripped from these bodies.
 *
 * Inc 1 ships effect A only; B / D / G land in later increments behind the same flag.
 */
import { WA } from '../../config/shaderPolish.js';

/**
 * A — Flowing-ink landing (intensity 0.62). fbm domain-warp; a soft maroon "ink" bloom follows the eased
 * pointer (u_mouse). Mounts behind the login/landing hero. §3.1: cream → --wa-paper, maroon → --wa-accent.
 */
export const INK_LANDING_FRAG = `
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float s=0.,a=0.5;for(int i=0;i<5;i++){s+=a*vn(p);p*=2.02;a*=0.5;}return s;}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float a=u_res.x/u_res.y; vec2 p=uv; p.x*=a;
  vec2 m=u_mouse; m.x*=a; float t=u_time*0.05*u_motion;
  vec2 q=vec2(fbm(p*2.0+t), fbm(p*2.0+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p*2.0+4.0*q+vec2(1.7,9.2)+0.15*t), fbm(p*2.0+4.0*q+vec2(8.3,2.8)-0.12*t));
  float md=exp(-2.5*length(p-m)); float f=fbm(p*2.0+4.0*r+md*1.3);
  float ink=smoothstep(0.34,0.78,f);
  vec3 cream=${WA.paper}, maroon=${WA.accent};
  vec3 col=mix(cream,maroon,ink*0.32*u_intensity);
  col=mix(col,maroon,md*0.07*u_intensity);
  gl_FragColor=vec4(col,1.0);
}`;

/**
 * B — Guilloché deed header (intensity 1.0). Engine-turned rosette lines on a vignette, behind deed /
 * certificate section-header strips (the title + "RECORDED" stamp render on top). §3.1: the strip sits on
 * --wa-surface-2 → cream = surface-2; maroon → --wa-accent. Not interactive.
 */
export const GUILLOCHE_HEADER_FRAG = `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float a=u_res.x/u_res.y; vec2 c=(uv-0.5); c.x*=a;
  float t=u_time*0.05*u_motion; float r=length(c), th=atan(c.y,c.x);
  float f1=sin(18.0*th+9.0*sin(6.2831*6.0*r-t));
  float f2=sin(11.0*th-7.0*cos(6.2831*9.0*r+t*0.8));
  float field=0.5*f1+0.5*f2;
  float lines=smoothstep(0.10,0.0,abs(fract(field*3.0)-0.5));
  float vign=smoothstep(0.02,0.14,r)*smoothstep(0.66,0.40,r);
  vec3 cream=${WA.surface2}, maroon=${WA.accent};
  vec3 col=mix(cream,maroon,lines*vign*0.55*u_intensity);
  gl_FragColor=vec4(col,1.0);
}`;

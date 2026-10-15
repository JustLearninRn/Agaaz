const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imgStyle=c=>c.img?`style="background-image:url('/api/img/${encodeURIComponent(c.id)}?v=${c.img}')"`:'';
function toast(m){document.querySelector('.toast')?.remove();const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),3500)}
setTimeout(()=>{$('#cl')?.remove();$('#cr')?.remove()},3000);
(function(){const cv=$('#sp'),cx=cv.getContext('2d');let P=[];
const rs=()=>{cv.width=innerWidth;cv.height=innerHeight};rs();addEventListener('resize',rs);
for(let i=0;i<70;i++)P.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:Math.random()*2+.5,v:Math.random()*.6+.2,a:Math.random()*6});
(function loop(){cx.clearRect(0,0,cv.width,cv.height);for(const p of P){p.y+=p.v;p.a+=.04;if(p.y>cv.height){p.y=-5;p.x=Math.random()*cv.width}
cx.globalAlpha=.4+.6*Math.abs(Math.sin(p.a));cx.fillStyle='#f6e27a';cx.beginPath();cx.arc(p.x,p.y,p.r,0,7);cx.fill()}requestAnimationFrame(loop)})()})();

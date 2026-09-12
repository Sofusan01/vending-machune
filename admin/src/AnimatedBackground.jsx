import {memo,useEffect,useState} from 'react';
import {motion,useReducedMotion} from 'framer-motion';

const colors=[
 'left-[-8%] top-[-12%] bg-[#9bcaff] opacity-25',
 'bottom-[-14%] right-[-8%] bg-[#ffc5a4] opacity-25',
 'bottom-[15%] left-[30%] bg-[#97a9be] opacity-20',
];

export default memo(function AnimatedBackground({active=true}) {
 const reducedMotion=useReducedMotion();
 const [visible,setVisible]=useState(()=>!document.hidden);
 // Generate once per mount: paths remain stable across kiosk clock/poll updates.
 const [paths]=useState(()=>colors.map(()=>({
  x:[0,Math.random()*50-25,Math.random()*50-25,0],
  y:[0,Math.random()*40-20,Math.random()*40-20,0],
  duration:15+Math.random()*5,
 })));
 useEffect(()=>{
  const update=()=>setVisible(!document.hidden);
  document.addEventListener('visibilitychange',update);
  return()=>document.removeEventListener('visibilitychange',update);
 },[]);
 const moving=active&&visible;
 return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
  {colors.map((color,index)=><motion.div
   key={color}
   className={`absolute size-[min(55vw,440px)] min-h-56 min-w-56 rounded-full blur-3xl ${color}`}
   initial={false}
   animate={moving?{x:paths[index].x,y:paths[index].y}:{x:0,y:0}}
   transition={moving?{duration:paths[index].duration,repeat:Infinity,ease:'easeInOut'}:{duration:0}}
  />)}
 </div>;
});

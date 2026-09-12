import {useEffect,useRef} from 'react';
export default function Modal({children,onClose,label,className=''}){
 const ref=useRef(null);
 useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
 return <dialog ref={ref} className={'app-modal '+className} aria-label={label} onCancel={e=>{e.preventDefault();onClose?.();}}>{children}</dialog>;
}

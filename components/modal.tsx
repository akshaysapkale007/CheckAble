'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({title,children,onClose,wide=false}:{title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close();},[]);
  return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current) onClose();}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19}/></button></div>{children}</dialog>;
}

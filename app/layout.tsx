import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'CheckAble',description:'A recruiter-controlled workspace for exploring resume evidence.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}

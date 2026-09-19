// A worker replenishes its own slot; slow requests never hold up other workers.
// Always drain in-flight requests before reporting a transport failure or pause.
export async function scanWorkers(concurrency:number,next:()=>Promise<boolean>,stopped:()=>boolean) {
  let failed=false;
  const outcomes=await Promise.allSettled(Array.from({length:concurrency},async()=>{
    while(!failed&&!stopped()) {
      try {if(!await next()) return;}
      catch(error) {failed=true;throw error;}
    }
  }));
  const failure=outcomes.find(result=>result.status==='rejected');
  if(failure?.status==='rejected') throw failure.reason;
}

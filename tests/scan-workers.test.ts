import { describe,it,expect,vi } from 'vitest';
import { scanWorkers } from '../lib/scan-workers';

describe('browser scan workers',()=>{
  it('drains active requests after a transport error without scheduling more work',async()=>{
    const gate=Promise.withResolvers<void>();
    let settled=false;
    const next=vi.fn<()=>Promise<boolean>>()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockImplementationOnce(async()=>{await gate.promise;return true;});
    const working=scanWorkers(2,next,()=>false).then(()=>{settled=true;},error=>{settled=true;return error;});
    await vi.waitFor(()=>expect(next).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    gate.resolve();
    expect(await working).toEqual(new Error('Connection lost'));
    expect(next).toHaveBeenCalledTimes(2);
  });
  it('stops replenishing on pause while allowing in-flight requests to settle',async()=>{
    const gate=Promise.withResolvers<void>();
    let stopped=false;
    const next=vi.fn(async()=>{await gate.promise;return true;});
    const working=scanWorkers(3,next,()=>stopped);
    await vi.waitFor(()=>expect(next).toHaveBeenCalledTimes(3));
    stopped=true;gate.resolve();await working;
    expect(next).toHaveBeenCalledTimes(3);
  });
});

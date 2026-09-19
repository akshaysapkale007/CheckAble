// Preserve rate-limit metadata that Jev MCP 0.1.0 otherwise drops from HTTP errors.
// The configured server still owns every request. This adds no retries or judgments.
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,init) {
  const response=await originalFetch(input,init);
  if(response.ok) return response;
  const value=response.headers.get('retry-after');
  const millis=response.headers.get('retry-after-ms');
  let seconds=0;
  if(value) seconds=Number.isFinite(Number(value))?Math.max(0,Number(value)):Math.max(0,Math.ceil((Date.parse(value)-Date.now())/1000)||0);
  if(millis&&Number.isFinite(Number(millis))) seconds=Math.max(seconds,Math.ceil(Number(millis)/1000));
  // Original error bodies may echo submitted resumes. Keep only safe error metadata.
  await response.body?.cancel();
  return new Response(JSON.stringify({message:'TypeSafe request failed.',upstream_status:response.status,retry_after_seconds:seconds}),{status:response.status,statusText:response.statusText,headers:{'content-type':'application/json',...(seconds?{'retry-after':String(seconds)}:{})}});
};

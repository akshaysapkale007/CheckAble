export class PublicError extends Error {
  constructor(message:string,public status=400,public retryAfter?:number){super(message);}
}
export function safeError(e:unknown) {
  if(e instanceof PublicError) return e.message;
  return 'The operation could not be completed. Check configuration and try again. Your completed results are saved.';
}

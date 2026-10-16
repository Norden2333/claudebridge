export class PreconditionError extends Error{
 constructor(message){super(message);this.code='CFB_PRECONDITION';this.precondition=true;}
}

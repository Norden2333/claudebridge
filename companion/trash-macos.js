// Fixed JXA helper, executed by macOS osascript (not by Node).
ObjC.import('Foundation');
function run(args) {
  if (args.length !== 1) throw Error('Invalid input');
  const error = Ref(), destination = Ref();
  const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(
    $.NSURL.fileURLWithPath(args[0]), destination, error
  );
  if (!ok) throw Error('Trash operation failed');
  return 'recycled';
}

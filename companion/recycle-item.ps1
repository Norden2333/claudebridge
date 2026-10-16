$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace ClaudeFolderRecycle {
 [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IShellItem {}
 [ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IFileOperation {
  void Advise(IFileOperationProgressSink sink, out uint cookie);
  void Unadvise(uint cookie);
  void SetOperationFlags(uint flags);
  void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
  void SetProgressDialog(IntPtr dialog);
  void SetProperties(IntPtr properties);
  void SetOwnerWindow(uint window);
  void ApplyPropertiesToItem(IShellItem item);
  void ApplyPropertiesToItems(IntPtr items);
  void RenameItem(IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, IFileOperationProgressSink sink);
  void RenameItems(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void MoveItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IFileOperationProgressSink sink);
  void MoveItems(IntPtr items, IShellItem destination);
  void CopyItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IFileOperationProgressSink sink);
  void CopyItems(IntPtr items, IShellItem destination);
  void DeleteItem(IShellItem item, IFileOperationProgressSink sink);
  void DeleteItems(IntPtr items);
  void NewItem(IShellItem destination, uint attributes, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, IFileOperationProgressSink sink);
  void PerformOperations();
  void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
 }
 [ComVisible(true), Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IFileOperationProgressSink {
  [PreserveSig] int StartOperations();
  [PreserveSig] int FinishOperations(int result);
  [PreserveSig] int PreRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int PostRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  [PreserveSig] int PreMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int PostMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  [PreserveSig] int PreCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int PostCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  [PreserveSig] int PreDeleteItem(uint flags, IShellItem item);
  [PreserveSig] int PostDeleteItem(uint flags, IShellItem item, int result, IShellItem created);
  [PreserveSig] int PreNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int PostNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, uint attributes, int result, IShellItem created);
  [PreserveSig] int UpdateProgress(uint total, uint completed);
  [PreserveSig] int ResetTimer();
  [PreserveSig] int PauseTimer();
  [PreserveSig] int ResumeTimer();
 }
 [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
 public class RecycleOnlySink : IFileOperationProgressSink {
  public int StartOperations(){return 0;} public int FinishOperations(int h){return 0;}
  public bool WillNuke, Nuked, Failed; public int Confirmed;
  public int PreDeleteItem(uint flags, IShellItem item){
   if((flags & 0x80)==0){WillNuke=true;return unchecked((int)0x80004004);}
   return 0;
  }
  public int PostDeleteItem(uint flags, IShellItem item, int result, IShellItem created){
   if(result<0){Failed=true;return 0;}
   if(created==null)Nuked=true;else Confirmed++;
   return 0;
  }
  public int PreRenameItem(uint f,IShellItem i,string n){return 0;} public int PostRenameItem(uint f,IShellItem i,string n,int h,IShellItem c){return 0;}
  public int PreMoveItem(uint f,IShellItem i,IShellItem d,string n){return 0;} public int PostMoveItem(uint f,IShellItem i,IShellItem d,string n,int h,IShellItem c){return 0;}
  public int PreCopyItem(uint f,IShellItem i,IShellItem d,string n){return 0;} public int PostCopyItem(uint f,IShellItem i,IShellItem d,string n,int h,IShellItem c){return 0;}
  public int PreNewItem(uint f,IShellItem d,string n){return 0;} public int PostNewItem(uint f,IShellItem d,string n,string t,uint a,int h,IShellItem c){return 0;}
  public int UpdateProgress(uint t,uint c){return 0;} public int ResetTimer(){return 0;} public int PauseTimer(){return 0;} public int ResumeTimer(){return 0;}
 }
 public class RecycleResult {
  public bool recycled,confirmedItem,permanentlyDeleted; public string reason;
 }
 public static class Recycle {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool GetVolumePathName(string target,StringBuilder buffer,uint length);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
  static extern uint GetDriveType(string root);
  public static bool CanRecycle(string target){
   if(String.IsNullOrWhiteSpace(target)||target.StartsWith(@"\\"))return false;
   var volume=new StringBuilder(32768);
   return GetVolumePathName(target,volume,(uint)volume.Capacity)&&GetDriveType(volume.ToString())==3;
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  static extern void SHCreateItemFromParsingName(string name, IntPtr context, ref Guid iid, out IShellItem item);
  public static RecycleResult Send(string target){
   if(!CanRecycle(target))return new RecycleResult {reason="not_recyclable"};
   IShellItem item=null; IFileOperation operation=null;
   try {
    Guid iid=new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
    SHCreateItemFromParsingName(target,IntPtr.Zero,ref iid,out item);
    operation=(IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09")));
    // Request recycling, veto explicit destructive callbacks, and verify the
    // Shell's created recycle item. RECYCLE_IF_POSSIBLE alone is not proof.
    operation.SetOperationFlags(0x00080000 | 0x00100000 | 0x20000000 | 0x0040 | 0x0004 | 0x0010 | 0x0400 | 0x4000);
    var sink=new RecycleOnlySink(); operation.DeleteItem(item,sink); operation.PerformOperations();
    bool aborted; operation.GetAnyOperationsAborted(out aborted);
    if(sink.Nuked)return new RecycleResult {permanentlyDeleted=true,reason="permanently_deleted"};
    if(sink.WillNuke)return new RecycleResult {reason="not_recyclable"};
    if(aborted||sink.Failed||sink.Confirmed<1)return new RecycleResult {reason="unconfirmed"};
    return new RecycleResult {recycled=true,confirmedItem=true};
   } finally {if(operation!=null)Marshal.FinalReleaseComObject(operation);if(item!=null)Marshal.FinalReleaseComObject(item);}
  }
 }
}
'@
try {
    if ([string]::IsNullOrWhiteSpace($env:CLAUDE_RECYCLE_TARGET)) { throw 'Missing target' }
    $result = [ClaudeFolderRecycle.Recycle]::Send($env:CLAUDE_RECYCLE_TARGET)
    [Console]::Write(($result | ConvertTo-Json -Compress))
    if ($result.permanentlyDeleted) { exit 3 }
    if (-not $result.recycled) { exit 2 }
} catch {
    [Console]::Write('{"recycled":false,"reason":"unconfirmed"}')
    exit 1
}

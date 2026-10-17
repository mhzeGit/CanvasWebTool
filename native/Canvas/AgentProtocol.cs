using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace CanvasNative;

public sealed class AgentRpcException(string code,string message):Exception(message)
{
    public string Code {get;}=code;
}

/// <summary>Agent protocol v1 never focuses the window, ends an editor or opens a dialog.</summary>
public sealed partial class ControlServer
{
    private string Revision=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Doc.Snapshot()))).ToLowerInvariant();
    private object AgentSnapshot()=>new{data=Doc.Root.Clone(),revision=Revision,file=Doc.FilePath,busy=window.HasPendingEdit};
    private void CheckRevision(JsonObject args,bool required=false)
    {
        var expected=args.S("expectedRevision");
        if((required&&expected.Length==0)||(expected.Length>0&&expected!=Revision))throw new AgentRpcException("ECONFLICT","Document revision changed; read again before editing.");
    }
    private void CheckAvailable()
    {
        if(window.HasPendingEdit)throw new AgentRpcException("EBUSY","A person is currently editing or dragging in Canvas; retry after that interaction finishes.");
    }
    private object DispatchAgent(string command,JsonObject args)
    {
        if(command=="agent.read")return AgentSnapshot();
        if(command=="agent.capabilities")return new{protocol=1,commands=new[]{"agent.read","agent.replace","agent.open","agent.new","agent.save","agent.undo","agent.redo"},atomicEdits=true,optimisticConcurrency=true,dialogs=false};
        CheckAvailable();CheckRevision(args,command=="agent.replace");
        switch(command)
        {
            case "agent.replace":
                var expectedPath=args.S("expectedPath");
                if(!string.Equals(expectedPath,Doc.FilePath??"",OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal))throw new AgentRpcException("ECONFLICT","Canvas switched to a different document.");
                if(args["data"] is not JsonObject data)throw new ArgumentException("data must be a legacy Canvas document object.");
                ValidateAgentRoot(data);Doc.Replace(data,reparent:false);return new{revision=Revision,file=Doc.FilePath,dirty=Doc.Dirty};
            case "agent.open":
                if(Doc.Dirty&&!args.B("discardChanges"))throw new AgentRpcException("EUNSAVED","Save the current canvas or explicitly set discardChanges before opening another document.");
                var path=args.S("path");if(string.IsNullOrWhiteSpace(path))throw new ArgumentException("open requires a path.");window.OpenPath(path);return new{revision=Revision,file=Doc.FilePath};
            case "agent.new":
                if(Doc.Dirty&&!args.B("discardChanges"))throw new AgentRpcException("EUNSAVED","Save the current canvas or explicitly set discardChanges before creating another document.");
                Doc.New();return new{revision=Revision,file=Doc.FilePath};
            case "agent.save":
                var destination=args.S("path",Doc.FilePath??"");
                if(destination.Length==0)throw new AgentRpcException("EPATH","An unsaved canvas needs an explicit save path.");
                destination=Path.GetFullPath(destination);
                var same=string.Equals(destination,Doc.FilePath,OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal);
                if(same&&window.AgentDiskChanged)throw new AgentRpcException("ECONFLICT","The file changed on disk; resolve the conflict before saving.");
                if(!same&&File.Exists(destination)&&!args.B("overwrite"))throw new AgentRpcException("EEXIST","Save destination exists; explicitly set overwrite to replace it.");
                window.SavePath(destination);return new{revision=Revision,file=Doc.FilePath,saved=true};
            case "agent.undo":
                if(!Doc.CanUndo)throw new AgentRpcException("EHISTORY","No edit to undo.");Doc.Undo();return new{revision=Revision,undone=true};
            case "agent.redo":
                if(!Doc.CanRedo)throw new AgentRpcException("EHISTORY","No edit to redo.");Doc.Redo();return new{revision=Revision,redone=true};
            default:throw new AgentRpcException("ENOCMD","Unknown agent command: "+command);
        }
    }
    private static void ValidateAgentRoot(JsonObject root)
    {
        var candidate=new Document();candidate.Load(root);
        foreach(var e in candidate.Entities)
        {
            var id=e.Data.N("id");if(id<=0||id!=Math.Floor(id))throw new ArgumentException("Entity ids must be positive integers.");
            if(e.Type=="shape"&&!new[]{"rectangle","circle","triangle","diamond"}.Contains(e.Data.S("shapeType")))throw new ArgumentException("Unknown shape type.");
            if(e.IsBox)
            {
                var seen=new HashSet<string>{e.Id};var next=e;
                while(next.Data["parentId"]!=null)
                {
                    var type=next.Data.S("parentType");if(type is not("textBox" or "shape"))throw new ArgumentException("Invalid parent type.");
                    var parent=candidate.Find(Document.Prefix[type]+"-"+next.Data.N("parentId"));
                    if(parent==null||!seen.Add(parent.Id))throw new ArgumentException("Dangling parent reference or parent cycle.");next=parent;
                }
            }
            else if(e.Type=="connection")
            {
                var a=candidate.At("textBox",e.Data["from"]);var b=candidate.At("textBox",e.Data["to"]);
                if(a==null||b==null||a.Id==b.Id)throw new ArgumentException("Invalid Bézier endpoints.");
            }
            else foreach(var end in new[]{"From","To"})if(e.Data["connected"+end]!=null&&candidate.At(e.Data.S("connected"+end+"Type"),e.Data["connected"+end])==null)throw new ArgumentException("Dangling line endpoint.");
        }
    }
}

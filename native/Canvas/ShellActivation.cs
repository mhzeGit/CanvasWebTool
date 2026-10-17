using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json.Nodes;

namespace CanvasNative;

/// <summary>Hands a user launch to an existing native session instead of opening a competing instance.</summary>
internal static class ShellActivation
{
    public static bool TryForward(string? documentPath)
    {
        if(!OperatingSystem.IsWindows())return false;
        try
        {
            var endpoint=JsonNode.Parse(File.ReadAllText(Path.Combine(NativeSettings.DirectoryPath,"endpoint.json"))).Obj();
            if(!endpoint.S("runtime").StartsWith("Avalonia",StringComparison.Ordinal))return false;
            var pid=(int)endpoint.N("pid");if(pid<=0||Process.GetProcessById(pid).HasExited)return false;
            var socket=endpoint.S("socket");const string prefix=@"\\.\pipe\";
            if(!socket.StartsWith(prefix+"canvaswebtool-",StringComparison.Ordinal))return false;
            using var pipe=new NamedPipeClientStream(".",socket[prefix.Length..],PipeDirection.InOut,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
            pipe.Connect(1500);
            using var writer=new StreamWriter(pipe,new UTF8Encoding(false),leaveOpen:true){AutoFlush=true};
            // Dispatch is acknowledged before any unsaved-changes dialog, so the launching process can exit.
            writer.WriteLine(new JsonObject{["id"]=1,["cmd"]="shell.open",["args"]=new JsonObject{["path"]=documentPath==null?null:Path.GetFullPath(documentPath)}}.ToJsonString());
            using var reader=new StreamReader(pipe,Encoding.UTF8,leaveOpen:true);
            var response=reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
            return JsonNode.Parse(response??"{}").B("ok");
        }
        catch(Exception error)when(error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or System.Text.Json.JsonException or TimeoutException){return false;}
    }
}

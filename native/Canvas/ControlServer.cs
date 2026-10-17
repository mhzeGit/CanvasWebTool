using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Threading;

namespace CanvasNative;

/// <summary>Same local NDJSON protocol as Electron: existing canvas CLI clients remain usable.</summary>
public sealed partial class ControlServer(MainWindow window):IDisposable
{
    private readonly CancellationTokenSource cancellation=new();
    private readonly ConcurrentDictionary<StreamWriter,bool> clients=new();
    private string PipeName=>"canvaswebtool-"+Regex.Replace(Environment.UserName,"[^A-Za-z0-9_-]","_")+(Environment.GetEnvironmentVariable("CANVASWEBTOOL_STATE_DIR") is string isolated?"-"+Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(isolated))))[..12]:"");
    private string Endpoint=>Path.Combine(NativeSettings.DirectoryPath,"endpoint.json");
    private bool started;
    private Document Doc=>window.Document;
    public void Start()
    {
        if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException("The native CLI bridge currently supports Windows named pipes.");
        if(File.Exists(Endpoint))
        {
            try{var pid=(int)JsonNode.Parse(File.ReadAllText(Endpoint)).N("pid");if(pid>0&&pid!=Environment.ProcessId&&!Process.GetProcessById(pid).HasExited)throw new IOException("Another Canvas app owns the CLI connection. Close that app before using the native CLI bridge.");}
            catch(ArgumentException){}catch(JsonException){}
        }
        started=true;Publish();_ = Accept();Doc.Changed+=Broadcast;
    }
    public JsonObject Status()=>new(){["running"]=true,["version"]="1.0.0-native",["filePath"]=Doc.FilePath,["fileName"]=Doc.FilePath==null?null:Path.GetFileName(Doc.FilePath),["dirty"]=Doc.Dirty,["pid"]=Environment.ProcessId,["runtime"]="Avalonia 11.2.7",["agentProtocol"]=1,["testMode"]=Program.Arguments.Contains("--test-mode"),["busy"]=window.HasPendingEdit};
    public void Publish()
    {
        if(!started)return;
        try{Directory.CreateDirectory(NativeSettings.DirectoryPath);var status=Status();status["socket"]=@"\\.\pipe\"+PipeName;status["updatedAt"]=DateTime.UtcNow.ToString("O");var path=Endpoint+".native.tmp";File.WriteAllText(path,status.ToJsonString());File.Move(path,Endpoint,true);}catch(IOException){}
    }
    private async Task Accept()
    {
        while(!cancellation.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe=null;
            try{pipe=new(PipeName,PipeDirection.InOut,NamedPipeServerStream.MaxAllowedServerInstances,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);await pipe.WaitForConnectionAsync(cancellation.Token);_ = Serve(pipe);}
            catch(OperationCanceledException){pipe?.Dispose();break;}catch(IOException){pipe?.Dispose();await Task.Delay(250,cancellation.Token);}
        }
    }
    private async Task Serve(NamedPipeServerStream pipe)
    {
        using(pipe)using(var reader=new StreamReader(pipe,new UTF8Encoding(false),leaveOpen:true))using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),leaveOpen:true){AutoFlush=true})
        {
            clients[writer]=false;
            try
            {
                while(!cancellation.IsCancellationRequested&&await reader.ReadLineAsync(cancellation.Token) is string line)
                {
                    JsonNode? id=null;
                    try
                    {
                        if(line.Length>32*1024*1024)throw new ArgumentException("Request exceeds 32 MB.");
                        var request=JsonNode.Parse(line).Obj();id=request["id"]?.DeepClone();var cmd=request.S("cmd");
                        object? result;
                        if(cmd=="watch"){clients[writer]=true;result=new{watching=true};}
                        else if(cmd=="unwatch"){clients[writer]=false;result=new{watching=false};}
                        else result=await Dispatcher.UIThread.InvokeAsync(()=>Dispatch(cmd,request["args"].Obj()));
                        Send(writer,new JsonObject{["id"]=id,["ok"]=true,["result"]=JsonSerializer.SerializeToNode(result)});
                    }
                    catch(Exception error){Send(writer,new JsonObject{["id"]=id,["ok"]=false,["error"]=new JsonObject{["code"]=error is AgentRpcException rpc?rpc.Code:error is KeyNotFoundException?"ENOENT":error is ArgumentException or InvalidDataException?"EINVAL":"EFAIL",["message"]=error.Message}});}
                }
            }
            catch(IOException){}catch(OperationCanceledException){}finally{clients.TryRemove(writer,out _);}
        }
    }
    private static void Send(StreamWriter writer,JsonObject message){try{lock(writer)writer.WriteLine(message.ToJsonString());}catch(IOException){}catch(ObjectDisposedException){}}
    private void Broadcast(){foreach(var(writer,watching)in clients)if(watching)Send(writer,new JsonObject{["event"]="changed",["payload"]=new JsonObject{["at"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});}
    private Entity Find(JsonObject args,string key="id")=>Doc.Find(args.S(key))??throw new KeyNotFoundException("No such entity: "+args.S(key));
    private JsonObject Describe(Entity e)=>((JsonArray)Portable.Export(Doc)["entities"]![Document.Plural[e.Type]]!).OfType<JsonObject>().First(x=>x.S("id")==e.Id).Clone();
    public async Task<object?> Dispatch(string cmd,JsonObject args)
    {
        if(cmd.StartsWith("agent.",StringComparison.Ordinal))return DispatchAgent(cmd,args);
        if(cmd=="status")return Status();
        if(cmd=="ping")return new{pong=true};
        window.FlushEdits();
        switch(cmd)
        {
            case "ping":return new{pong=true};
            case "status":return Status();
            case "read":return Portable.Export(Doc);
            case "list":
                var groups=Portable.Export(Doc)["entities"].Obj().Clone();var type=args.S("type");if(type.Length>0){var key=Document.Plural.GetValueOrDefault(type,type);if(groups[key]==null)throw new ArgumentException("Unknown entity type.");foreach(var k in groups.Select(x=>x.Key).Where(k=>k!=key).ToList())groups.Remove(k);}return groups;
            case "get":return Describe(Find(args));
            case "add-subcanvas":return Describe(window.AddAt("subCanvas",window.SurfaceControl.Center));
            case "enter-canvas":
                var card=Find(args);if(card.Data["subCanvas"] is not JsonObject)throw new ArgumentException("Entity is not a sub-canvas.");window.EnterCanvas(card);return new{path=Doc.CanvasPath.ToArray()};
            case "navigate-canvas":window.NavigateCanvas((int)args.N("depth"));return new{path=Doc.CanvasPath.ToArray()};
            case "add":
                var t=args.S("type");if(!Document.Plural.ContainsKey(t))throw new ArgumentException("Unknown entity type.");
                if(t=="connection")return await Dispatch("connect",new JsonObject{["from"]=args["props"].S("from"),["to"]=args["props"].S("to"),["kind"]="connection",["label"]=args["props"].S("label")});
                Entity? added=null;Doc.Edit(()=>{added=Doc.Create(t,window.SurfaceControl.Center);Portable.Apply(added,args["props"].Obj());});return Describe(added!);
            case "update":
                var entity=Find(args);List<string>? changed=null;Doc.Edit(()=>changed=Portable.Apply(entity,args["props"].Obj()));return new{id=entity.Id,changed,entity=Describe(entity)};
            case "delete":
                var deleted=Find(args);Doc.Select(deleted.Id);if(deleted.Locked)throw new ArgumentException("Unlock the entity before deleting it.");Doc.DeleteSelection();return new{deleted=deleted.Id};
            case "connect":
                var from=Find(args,"from");var to=Find(args,"to");Entity? connection=null;Doc.Edit(()=>{connection=Doc.Connect(from,to,args.S("kind","arrow"),args.S("label"));if(args.S("color") is {Length:>0} color)connection.Data["color"]=color;});return Describe(connection!);
            case "select":
                var selection=args["ids"] is JsonArray ids?ids.Select(id=>id!.GetValue<string>()).ToArray():args.S("id") is {Length:>0} selected?[selected]:Array.Empty<string>();Doc.Select(selection);return new{selected=Doc.Selection.ToArray()};
            case "undo":Doc.Undo();return new{undone=true};
            case "redo":Doc.Redo();return new{redone=true};
            case "new":if(!args.B("force")&&!await window.GuardUnsaved())return new{cancelled=true};Doc.New();return Status();
            case "open":if(!args.B("force")&&!await window.GuardUnsaved())return new{cancelled=true};window.OpenPath(args.S("path"));return Status();
            case "save":
                if(args.S("path") is {Length:>0} path)window.SavePath(path);else await window.Save();return Status();
            case "import":
                if(!args.B("force")&&!await window.GuardUnsaved())return new{cancelled=true};var incoming=(args["document"]??args["data"]??args["json"]).Obj();Doc.Replace(incoming);return Status();
            case "focus":window.Activate();return new{focused=true};
            case "focus-content":window.SurfaceControl.FocusContent(args.B("all"));return new{focused=true};
            case "screenshot":await Task.Delay(180);window.Capture(args.S("path"),args.B("canvasOnly"));return new{path=args.S("path")};
            case "set-tool":window.SetTool(args.S("tool","cursor"));return new{tool=window.SurfaceControl.Tool};
            case "set-theme":window.SetTheme(args.S("theme","dark"));return new{theme=args.S("theme")};
            case "resize-window":window.Width=args.N("width",1200);window.Height=args.N("height",720);window.FindControl<Avalonia.Controls.Grid>("Workspace")!.ColumnDefinitions[3].Width=new Avalonia.Controls.GridLength(Math.Clamp(window.Width*.24,220,420));return new{width=window.Width,height=window.Height};
            case "quit":if(args.B("force")){Doc.New();}Dispatcher.UIThread.Post(window.Close);return new{quitting=true};
            default:throw new ArgumentException("Unknown command: "+cmd);
        }
    }
    public void Dispose()
    {
        Doc.Changed-=Broadcast;cancellation.Cancel();foreach(var client in clients.Keys){try{client.Dispose();}catch{}}
        if(started){try{if(JsonNode.Parse(File.ReadAllText(Endpoint)).N("pid")==Environment.ProcessId)File.Delete(Endpoint);}catch(IOException){}}
        started=false;
    }
}

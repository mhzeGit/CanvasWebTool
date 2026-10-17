using Avalonia;
using CanvasNative;
using System.Text.Json.Nodes;

var count=0;
void Check(bool condition,string label){if(!condition)throw new Exception("FAIL: "+label);Console.WriteLine("PASS: "+label);count++;}
void Reject(Action action,string label){try{action();}catch{Check(true,label);return;}throw new Exception("FAIL: "+label);}
var temp=Path.Combine(Path.GetTempPath(),"canvas-native-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);
try
{
    var d=new Document();Check(!d.Dirty,"new document clean");
    Entity? a=null,b=null,shape=null,arrow=null,curve=null;
    d.Edit(()=>{a=d.Create("textBox",new(80,80));a.Data["title"]="Ingest";a.Data["text"]="Reads **.cvdoc** files";});
    d.Edit(()=>b=d.Create("textBox",new(520,320)));
    d.Edit(()=>shape=d.Create("shape",new(520,80),new(160,160),"circle"));
    d.Edit(()=>arrow=d.Connect(a!,shape!,"arrow"));d.Edit(()=>curve=d.Connect(a!,b!,"connection","then"));
    Check(d.Entities.Count()==5,"all entities created");Check(d.Dirty,"mutation marks dirty");
    var path=Path.Combine(temp,"roundtrip.cvdoc");d.Save(path);Check(!d.Dirty,"save marks clean");
    var reopened=new Document();reopened.Open(path);Check(reopened.Entities.Count()==5,"legacy round trip preserves all types");Check(reopened.List("connection").Count==1,"Bézier connection survives save");
    Check(reopened.At("shape",reopened.Find(arrow!.Id)!.Data["connectedTo"])!.Id==shape!.Id,"attached shape reference survives save");
    d.Undo();Check(d.List("connection").Count==0,"undo link creation");d.Redo();Check(d.List("connection").Count==1,"redo link creation");Check(!d.Dirty,"undo/redo to saved state marks clean");
    var portable=Portable.Export(d);var imported=new Document();imported.Load(portable);Check(imported.List("connection").Count==1,"portable curve round trip");Check(imported.Find(a!.Id)!.Data.S("title")=="Ingest","portable properties round trip");
    var before=d.Snapshot();Reject(()=>d.Edit(()=>{d.Create("shape",new());Portable.Apply(a!,new(){["unknown"]=1});}),"invalid edit rejected");Check(before==d.Snapshot(),"failed transaction rolls back all changes");
    a=d.Find(a!.Id);b=d.Find(b!.Id);shape=d.Find(shape!.Id);
    Reject(()=>d.Connect(a!,a!,"arrow"),"self link rejected");Reject(()=>d.Connect(a!,shape!,"connection"),"Bézier to shape rejected");
    var duplicate=d.Connect(a!,b!,"connection");Check(duplicate.Id==curve!.Id,"duplicate curve reuses existing link");
    d.Select(a!.Id,b!.Id);var clip=d.CopySelection();var original=d.Entities.Count();d.Paste(clip,new(20,20));Check(d.Entities.Count()==original+3,"duplicate copies selected nodes and their curve");Check(d.Selection.Count==3,"duplicate selects new entities");
    var pasted=Portable.Export(d);var pastedCurve=((JsonArray)pasted["entities"]!["connections"]!).OfType<JsonObject>().Last();Check(pastedCurve.S("from")!=a.Id&&pastedCurve.S("to")!=b!.Id,"duplicated links point to copied nodes");
    d.Undo();Check(d.Entities.Count()==original,"undo duplicate is one operation");
    d.Select(a.Id);d.DeleteSelection();Check(d.List("connection").Count==0,"deleting text box removes dependent curve");Check(d.Find(arrow.Id)!.Data["connectedFrom"]==null,"deleting box detaches arrow");Check(d.Find(b!.Id)!=null,"deleting earlier index preserves other box");d.Undo();Check(d.List("connection").Count==1,"undo deletion restores references");
    a=d.Find(a.Id);d.Edit(()=>a!.Data["locked"]=true);d.Select(a!.Id);d.DeleteSelection();Check(d.Find(a.Id)!=null,"locked object protected from deletion");d.Edit(()=>a.Data["locked"]=false);
    var parent=d.Create("shape",new(0,0),new(1000,1000));d.Reparent();Check(d.Find(a.Id)!.Data.N("parentId")==parent.Data.N("id"),"containment creates parent");Check(d.Depth(a)>0,"draw depth follows parent");
    d.Select(parent.Id);Check(d.MovingSelection().Count()>1,"parent movement includes children");
    Check(GeometryMath.Hit(shape!,shape!.Bounds.Center),"circle center hit");Check(!GeometryMath.Hit(shape,shape.Bounds.TopLeft),"circle bounding corner excluded");
    var edge=GeometryMath.Edge(shape,new(1000,160));Check(Math.Abs(edge.X-shape.Bounds.Right)<.01,"ellipse attachment on boundary");
    foreach(var type in new[]{"triangle","diamond"}){var polygon=d.Create("shape",new(0,0),new(100,100),type);Check(GeometryMath.Hit(polygon,new(50,50))&&!GeometryMath.Hit(polygon,new(1,1)),type+" polygon hit testing");}
    a.Data["customExtension"]=new JsonObject{["kept"]=true};a.Data["content"]=new JsonObject{["type"]="doc",["content"]=new JsonArray(new JsonObject{["type"]="paragraph",["content"]=new JsonArray(new JsonObject{["type"]="text",["text"]="Rich",["marks"]=new JsonArray(new JsonObject{["type"]="bold"})})})};a.Data["text"]="";
    var richSnapshot=a.Data["content"]!.ToJsonString();d.Save(path);reopened.Open(path);Check(reopened.Find(a.Id)!.Data["content"]!.ToJsonString()==richSnapshot,"Tiptap JSON preserved losslessly");Check(reopened.Find(a.Id)!.Data["customExtension"]!.B("kept"),"unknown entity fields preserved");Check(RichText.Markdown(a.Data)=="**Rich**","Tiptap bold translated for native view");
    var png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC2kAAAAASUVORK5CYII=";
    shape=d.Find(shape.Id);d.Edit(()=>shape!.Data["image"]=new JsonObject{["src"]="data:image/png;base64,"+png,["x"]=10,["y"]=10,["w"]=100,["h"]=100});d.Save(path);Check(shape!.Data["image"].S("src").StartsWith("data:"),"saving never strips live image");Check(Directory.GetFiles(Document.AssetDir(path)).Length==1,"image asset extracted beside cvdoc");reopened.Open(path);Check(reopened.Find(shape.Id)!.Data["image"].S("src")=="data:image/png;base64,"+png,"asset re-embedded on open");
    var secondPath=Path.Combine(temp,"saved-as.cvdoc");reopened.Save(secondPath);var second=new Document();second.Open(secondPath);Check(second.Find(shape.Id)!.Data["image"].S("src").StartsWith("data:"),"Save As relocates assets correctly");
    var bad=d.Root.Clone();((JsonArray)bad["document"]!["shapes"]!)[0]!["image"]=new JsonObject{["assetPath"]="../private.png"};Reject(()=>new Document().Load(bad,path),"asset traversal rejected");
    var badSize=d.Root.Clone();((JsonArray)badSize["document"]!["shapes"]!)[0]!["w"]=-1;Reject(()=>new Document().Load(badSize),"negative dimensions rejected");
    Reject(()=>Portable.Apply(a,new(){["size"]=new JsonObject{["w"]=-4}}),"invalid property size rejected");
    Portable.Apply(a,new(){["content"]="Updated"});Check(a.Data["content"]==null&&a.Data["blocks"]==null,"editing Markdown clears stale rich text caches");
    var blockData=new JsonObject{["blocks"]=new JsonArray(new JsonObject{["t"]="h1",["s"]=new JsonArray(new JsonObject{["t"]="Heading"})})};Check(RichText.Markdown(blockData)=="# Heading","legacy block heading rendered");
    var connector=d.Create("connector",new(0,0));var full=new Document();full.Load(Portable.Export(d));Check(full.Find(connector.Id)!=null,"native-created integer defaults survive portable import");
    Check(RichText.Markdown(new JsonObject{["blocks"]=new JsonArray(new JsonObject{["t"]="chk",["c"]=true,["s"]=new JsonArray(new JsonObject{["t"]="Done",["b"]=true,["fc"]="#81c784"})})})=="- [x] {#81c784:**Done**}","legacy checkbox and span schema preserved");
    var nestedDoc=new Document();Entity? portal=null;
    nestedDoc.Edit(()=>portal=nestedDoc.CreateSubCanvas(new(100,100)));
    nestedDoc.Viewport["offsetX"]=42;
    nestedDoc.EnterCanvas(portal!.Id);Check(!nestedDoc.Entities.Any()&&nestedDoc.Viewport.N("offsetX")==0,"sub-canvas starts clean with independent viewport");
    Entity? inner=null; nestedDoc.Edit(()=>inner=nestedDoc.Create("textBox",new(20,20)));
    nestedDoc.Edit(()=>nestedDoc.CreateSubCanvas(new(300,100)));
    var deeper=nestedDoc.Entities.Last();nestedDoc.EnterCanvas(deeper.Id);
    nestedDoc.Edit(()=>{var image=nestedDoc.Create("shape",new(10,10));image.Data["image"]=new JsonObject{["src"]="data:image/png;base64,"+png};});
    Check(nestedDoc.CanvasPath.Count==2&&nestedDoc.Entities.Count()==1,"sub-canvases nest recursively");
    nestedDoc.Undo();Check(!nestedDoc.Entities.Any(),"nested edit undo");nestedDoc.Redo();Check(nestedDoc.Entities.Count()==1,"nested edit redo");
    var nestedPath=Path.Combine(temp,"nested.cvdoc");nestedDoc.Save(nestedPath);
    var nestedOpen=new Document();nestedOpen.Open(nestedPath);Check(nestedOpen.CanvasPath.Count==0&&nestedOpen.Entities.Count()==1,"save inside nested canvas keeps root document");
    nestedOpen.EnterCanvas(portal.Id);nestedOpen.EnterCanvas(deeper.Id);Check(nestedOpen.Entities.Single().Data["image"].S("src").StartsWith("data:image/png"),"nested image extracted and re-embedded on open");
    nestedOpen.NavigateCanvas(0);Check(nestedOpen.Viewport.N("offsetX")==42,"return restores parent viewport");
    var exportedNested=Portable.Export(nestedOpen);var portableNested=new Document();portableNested.Load(exportedNested);portableNested.EnterCanvas(portal.Id);Check(portableNested.Entities.Count()==2,"portable round trip preserves sub-canvas");
    nestedOpen.Select(portal.Id);nestedOpen.Paste(nestedOpen.CopySelection(),new(20,20));
    var copied=nestedOpen.Entities.Last();nestedOpen.EnterCanvas(copied.Id);nestedOpen.Edit(()=>nestedOpen.Create("shape",new()));nestedOpen.NavigateCanvas(0);nestedOpen.EnterCanvas(portal.Id);Check(nestedOpen.Entities.Count()==2,"duplicated sub-canvas owns independent nested document");
    var invalidNested=nestedOpen.Root.Clone();var invalidBody=Document.CanvasBodies(invalidNested["document"].Obj()).Last();((JsonArray)invalidBody["shapes"]!)[0]!["w"]=-1;
    Reject(()=>new Document().Load(invalidNested),"invalid nested geometry rejected");
    nestedDoc.NavigateCanvas(0);nestedDoc.Select(portal.Id);nestedDoc.DeleteSelection();nestedDoc.Undo();Check(nestedDoc.Entities.Single().Data["subCanvas"] is JsonObject,"undo portal deletion restores entire subtree");
    Console.WriteLine($"Native checks passed: {count}");
}
finally{Directory.Delete(temp,true);}

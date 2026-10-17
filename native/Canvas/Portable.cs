using System.Text.Json.Nodes;
namespace CanvasNative;

/// <summary>Translates stable CLI ids to legacy on-disk array references.</summary>
public static class Portable
{
    public static JsonObject Export(Document doc)
    {
        var groups = new JsonObject();
        foreach (var type in Document.Plural.Keys)
        {
            var list = new JsonArray(); groups[Document.Plural[type]] = list;
            foreach (var e in doc.Entities.Where(e => e.Type == type))
            {
                var d = e.Data; var p = new JsonObject { ["id"] = e.Id, ["locked"] = e.Locked, ["nativeData"] = d.DeepClone() }; var style = new JsonObject(); p["style"] = style;
                if (e.IsBox)
                {
                    p["position"] = new JsonObject { ["x"] = d.N("x"), ["y"] = d.N("y") }; p["size"] = new JsonObject { ["w"] = d.N("w",120), ["h"] = d.N("h",80) };
                    style["backgroundColor"] = d.S("color", "#1a1a1a"); style["borderColor"] = d.S("borderColor", "#444");
                    p["parent"] = d["parentId"] != null && Document.Prefix.TryGetValue(d.S("parentType"), out var prefix) ? new JsonObject { ["entityId"] = prefix + "-" + d.N("parentId"), ["type"] = d.S("parentType") } : null;
                    if (type == "textBox") { p["title"] = d.S("title"); if(d["subCanvas"] is JsonObject nested)p["subCanvas"]=nested.DeepClone(); p["content"] = RichText.Markdown(d); p["blocks"] = d["blocks"]?.DeepClone(); foreach(var f in new[]{"textColor","titleColor","fontSize"}) style[f]=d[f]?.DeepClone(); }
                    else { p["type"]=d.S("shapeType","rectangle"); p["image"]=d["image"]?.DeepClone(); style["borderWidth"]=d.N("borderWidth",2); style["cornerRadius"]=d.N("cornerRadius",4); }
                }
                else
                {
                    style["color"]=d.S("color","#6bb5ff");
                    if(type=="connection") { p["from"]=doc.At("textBox",d["from"])?.Id; p["to"]=doc.At("textBox",d["to"])?.Id; p["label"]=d.S("text"); }
                    else
                    {
                        p["startPoint"]=new JsonObject{["x"]=d.N("x1"),["y"]=d.N("y1")}; p["endPoint"]=new JsonObject{["x"]=d.N("x2"),["y"]=d.N("y2")};
                        foreach(var end in new[]{"From","To"}) { var target=doc.At(d.S("connected"+end+"Type"),d["connected"+end]); p["connected"+end]=target==null?null:new JsonObject{["entityId"]=target.Id,["type"]=target.Type}; }
                        style["lineWidth"]=d.N("lineWidth",2); style["headSize"]=d.N("headSize",14);
                    }
                }
                list.Add(p);
            }
        }
        return new(){["meta"]=new JsonObject{["format"]="canvaswebtool-portable",["version"]=1,["exportedAt"]=DateTime.UtcNow.ToString("O")},["viewport"]=doc.Viewport.DeepClone(),["entities"]=groups};
    }
    private static double NumericId(string id) => double.TryParse(id[(id.IndexOf('-')+1)..],System.Globalization.CultureInfo.InvariantCulture,out var d)&&double.IsFinite(d)&&d>0?d:0;
    public static JsonObject Import(JsonObject p)
    {
        if(p["meta"].N("version",1)!=1) throw new InvalidDataException("Unsupported portable version.");
        var doc=new Document(); var groups=p["entities"].Obj(); var ids=new Dictionary<string,Entity>();
        foreach(var type in Document.Plural.Keys)
        {
            if(groups[Document.Plural[type]] is not JsonArray list) continue;
            var reserved=list.OfType<JsonObject>().Select(x=>NumericId(x.S("id"))).DefaultIfEmpty().Max();
            foreach(var item in list.OfType<JsonObject>())
            {
                var e=doc.Create(type,new());
                if(item["nativeData"] is JsonObject raw) foreach(var f in raw) e.Data[f.Key]=f.Value?.DeepClone();
                var id=NumericId(item.S("id")); e.Data["id"]=id>0?id:++reserved;
                if(item.S("id") is {Length:>0} key && !ids.TryAdd(key,e)) throw new InvalidDataException("Duplicate portable id: "+key);
                Apply(e,item,false);
                if(type=="textBox"&&item["nativeData"] is JsonObject rich&&item.S("content")==RichText.Markdown(rich)&&rich["content"]!=null)e.Data["content"]=rich["content"]!.DeepClone();
                if(type=="textBox") { e.Data["blocks"]=item["blocks"]?.DeepClone(); if(item["subCanvas"] is JsonObject nested)e.Data["subCanvas"]=nested.DeepClone(); }
                if(type=="shape") e.Data["image"]=item["image"]?.DeepClone();
            }
        }
        foreach(var type in Document.Plural.Keys)
        {
            if(groups[Document.Plural[type]] is not JsonArray list) continue;
            var internals=doc.Entities.Where(e=>e.Type==type).ToList();
            for(var i=0;i<internals.Count;i++)
            {
                var item=list[i].Obj(); var e=internals[i];
                if(e.IsBox) { var parent=ids.GetValueOrDefault(item["parent"].S("entityId")); e.Data["parentId"]=parent?.Data["id"]?.DeepClone(); e.Data["parentType"]=parent?.Type; }
                else if(type=="connection") { var a=ids.GetValueOrDefault(item.S("from"));var b=ids.GetValueOrDefault(item.S("to")); if(a?.Type!="textBox"||b?.Type!="textBox") {doc.List(type).Remove(e.Data);continue;} e.Data["from"]=doc.List("textBox").IndexOf(a.Data);e.Data["to"]=doc.List("textBox").IndexOf(b.Data); }
                else foreach(var end in new[]{"From","To"}) {var r=item["connected"+end];var target=r is JsonObject?r.S("entityId"):r?.GetValue<string>(); doc.Attach(e,end,ids.GetValueOrDefault(target??""));}
            }
        }
        doc.Body["viewport"]=p["viewport"]?.DeepClone()??new JsonObject{["offsetX"]=0,["offsetY"]=0,["scale"]=1}; return doc.Root;
    }
    public static Dictionary<string,string> Fields(string type)
    {
        var m=new Dictionary<string,string>{["locked"]="locked"};
        if(type is "shape" or "textBox")
        {
            foreach(var f in new[]{"x","y"})m["position."+f]=f; foreach(var f in new[]{"w","h"})m["size."+f]=f;
            m["style.backgroundColor"]="color";m["style.borderColor"]="borderColor";
            if(type=="textBox"){m["title"]="title";m["content"]="text";foreach(var f in new[]{"textColor","titleColor","fontSize"})m["style."+f]=f;}
            else {m["type"]="shapeType";m["style.borderWidth"]="borderWidth";m["style.cornerRadius"]="cornerRadius";}
        }
        else {m["style.color"]="color";if(type=="connection")m["label"]="text";else {m["startPoint.x"]="x1";m["startPoint.y"]="y1";m["endPoint.x"]="x2";m["endPoint.y"]="y2";if(type=="arrow"){m["style.lineWidth"]="lineWidth";m["style.headSize"]="headSize";}}}
        return m;
    }
    public static List<string> Apply(Entity e,JsonObject props,bool strict=true)
    {
        var map=Fields(e.Type);var changed=new List<string>();
        foreach(var(path,value) in Flatten(props))
        {
            if(!map.TryGetValue(path,out var f)){if(strict)throw new ArgumentException("Unknown writable field: "+path);continue;}
            if(f=="shapeType"&&!new[]{"rectangle","circle","triangle","diamond"}.Contains(value?.GetValue<string>()))throw new ArgumentException("Unknown shape type.");
            if(f=="locked"){if(value is not JsonValue b||!b.TryGetValue<bool>(out _))throw new ArgumentException("locked must be boolean.");}
            else if(new[]{"x","y","w","h","x1","y1","x2","y2","fontSize","borderWidth","cornerRadius","lineWidth","headSize"}.Contains(f))
            { if(!Json.TryNumber(value,out var d)||Math.Abs(d)>1e9||(new[]{"w","h","fontSize"}.Contains(f)&&d<=0)||(new[]{"borderWidth","cornerRadius","lineWidth","headSize"}.Contains(f)&&d<0))throw new ArgumentException("Invalid number: "+path); }
            else if(value is not JsonValue s||!s.TryGetValue<string>(out _))throw new ArgumentException("Expected text: "+path);
            if(JsonNode.DeepEquals(e.Data[f],value))continue;
            e.Data[f]=value?.DeepClone();changed.Add(path);
            if(f=="text"&&e.Type=="textBox"){e.Data.Remove("content");e.Data.Remove("blocks");}
        }
        return changed;
    }
    private static IEnumerable<(string,JsonNode?)> Flatten(JsonObject o,string prefix="")
    {foreach(var p in o){var path=prefix+p.Key;if(p.Value is JsonObject child){foreach(var f in Flatten(child,path+"."))yield return f;}else yield return(path,p.Value);}}
}

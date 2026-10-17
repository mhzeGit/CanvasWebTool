using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;

namespace CanvasNative;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new() { WriteIndented = true };
    public static bool TryNumber(JsonNode? node,out double d)
    {
        d=0;if(node is not JsonValue v)return false;
        if(v.TryGetValue<double>(out d))return double.IsFinite(d);
        if(v.TryGetValue<int>(out var i)){d=i;return true;}
        if(v.TryGetValue<long>(out var l)){d=l;return true;}
        if(v.TryGetValue<decimal>(out var m)){d=(double)m;return true;}
        return false;
    }
    public static double N(this JsonNode? n, string key, double fallback = 0) => TryNumber(n?[key],out var d)?d:fallback;
    public static string S(this JsonNode? n, string key, string fallback = "") => n?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : fallback;
    public static bool B(this JsonNode? n, string key) => n?[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    public static JsonObject Clone(this JsonObject obj) => (JsonObject)obj.DeepClone();
    public static JsonObject Obj(this JsonNode? node) => node as JsonObject ?? new();
}

public sealed record Entity(string Type, JsonObject Data)
{
    public string Id => Document.Prefix[Type] + "-" + Data.N("id").ToString(CultureInfo.InvariantCulture);
    public bool IsBox => Type is "shape" or "textBox";
    public bool Locked => Data.B("locked");
    public Rect Bounds => IsBox ? new(Data.N("x"), Data.N("y"), Math.Max(1, Data.N("w", 120)), Math.Max(1, Data.N("h", 80))) : new Rect(new Point(Data.N("x1"), Data.N("y1")), new Point(Data.N("x2"), Data.N("y2")));
}

/// <summary>Owns the legacy JSON tree so unknown fields and rich-text documents survive native edits.</summary>
public sealed class Document
{
    public static readonly Dictionary<string, string> Plural = new() { ["textBox"] = "textBoxes", ["shape"] = "shapes", ["arrow"] = "arrows", ["connector"] = "connectors", ["connection"] = "connections" };
    public static readonly Dictionary<string, string> Prefix = new() { ["textBox"] = "tb", ["shape"] = "shp", ["arrow"] = "arr", ["connector"] = "cnr", ["connection"] = "cnn" };
    public JsonObject Root { get; private set; } = Empty();
    private readonly List<string> canvasPath = [];
    public IReadOnlyList<string> CanvasPath => canvasPath;
    public JsonObject Body
    {
        get
        {
            var body = Root["document"].Obj();
            for (var i = 0; i < canvasPath.Count; i++)
            {
                var card = (body["textBoxes"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => "tb-" + x.N("id").ToString(CultureInfo.InvariantCulture) == canvasPath[i]);
                if (card?["subCanvas"] is not JsonObject child) { canvasPath.RemoveRange(i, canvasPath.Count-i); break; }
                body = child;
            }
            return body;
        }
    }
    public IEnumerable<string> CanvasTitles
    {
        get
        {
            _ = Body; var body = Root["document"].Obj();
            foreach (var id in canvasPath)
            {
                var card = ((JsonArray)body["textBoxes"]!).OfType<JsonObject>().First(x => "tb-" + x.N("id").ToString(CultureInfo.InvariantCulture) == id);
                yield return card.S("title", "Untitled canvas"); body = card["subCanvas"].Obj();
            }
        }
    }
    public void EnterCanvas(string id) { if (Find(id)?.Data["subCanvas"] is not JsonObject) return; canvasPath.Add(id); Selection.Clear(); Notify(); }
    public void NavigateCanvas(int depth) { depth = Math.Clamp(depth,0,canvasPath.Count); canvasPath.RemoveRange(depth,canvasPath.Count-depth); Selection.Clear(); Notify(); }
    public Entity CreateSubCanvas(Point point, Size? size = null)
    {
        var card = Create("textBox",point,size ?? new Size(280,180));
        card.Data["title"] = "Untitled canvas"; card.Data["borderColor"] = "#6bb5ff";
        card.Data["subCanvas"] = Empty()["document"]!.DeepClone(); return card;
    }
    public static IEnumerable<JsonObject> CanvasBodies(JsonObject body)
    {
        yield return body;
        foreach (var card in (body["textBoxes"] as JsonArray ?? new()).OfType<JsonObject>())
            if (card["subCanvas"] is JsonObject child)
                foreach (var nested in CanvasBodies(child)) yield return nested;
    }
    public JsonObject Viewport => Body["viewport"].Obj();
    public string? FilePath { get; private set; }
    private string saved = "";
    private readonly List<(string Snapshot, string[] Path)> undo = [], redo = [];
    public HashSet<string> Selection { get; } = [];
    public event Action? Changed;
    public bool Dirty => Snapshot() != saved;
    public bool CanUndo => undo.Count > 0;
    public bool CanRedo => redo.Count > 0;
    public Document() => saved = Snapshot();
    public static JsonObject Empty() => new() { ["format"] = "canvaswebtool-document", ["version"] = 1, ["metadata"] = new JsonObject(), ["document"] = new JsonObject { ["viewport"] = new JsonObject { ["offsetX"] = 0, ["offsetY"] = 0, ["scale"] = 1 }, ["settings"] = new JsonObject(), ["textBoxes"] = new JsonArray(), ["shapes"] = new JsonArray(), ["arrows"] = new JsonArray(), ["connectors"] = new JsonArray(), ["connections"] = new JsonArray() } };
    public JsonArray List(string type) => (JsonArray)Body[Plural[type]]!;
    public IEnumerable<Entity> Entities => Plural.Keys.SelectMany(t => List(t).OfType<JsonObject>().Select(d => new Entity(t, d)));
    public Entity? Find(string? id) => Entities.FirstOrDefault(e => e.Id == id);
    public Entity? At(string type, JsonNode? index) => index is JsonValue v && v.TryGetValue<int>(out var i) && Plural.ContainsKey(type) && i >= 0 && i < List(type).Count ? new(type, List(type)[i].Obj()) : null;
    public string Snapshot() => Root.ToJsonString();
    public void Notify() => Changed?.Invoke();
    public void Select(params string[] ids) { Selection.Clear(); Selection.UnionWith(ids.Where(id => Find(id) != null)); Notify(); }
    public void Commit(string before,bool reparent=true)
    {
        if (Snapshot() == before) { Notify(); return; }
        undo.Add((before, canvasPath.ToArray()));
        if (undo.Count > 200) undo.RemoveAt(0);
        redo.Clear();
        if(reparent)Reparent();
        Notify();
    }
    public void Edit(Action action,bool reparent=true) { var before = Snapshot(); try { action(); Commit(before,reparent); } catch { Restore(before); throw; } }
    public void Restore(string snapshot) { Root = JsonNode.Parse(snapshot).Obj(); Selection.RemoveWhere(id => Find(id) == null); Notify(); }
    public void Undo() { if (!CanUndo) return; var last = undo[^1]; redo.Add((Snapshot(),last.Path)); undo.RemoveAt(undo.Count - 1); canvasPath.Clear(); canvasPath.AddRange(last.Path); Restore(last.Snapshot); }
    public void Redo() { if (!CanRedo) return; var last = redo[^1]; undo.Add((Snapshot(),last.Path)); redo.RemoveAt(redo.Count - 1); canvasPath.Clear(); canvasPath.AddRange(last.Path); Restore(last.Snapshot); }
    public void New() { Root = Empty(); canvasPath.Clear(); FilePath = null; undo.Clear(); redo.Clear(); Selection.Clear(); saved = Snapshot(); Notify(); }
    public void Load(JsonObject input, string? path = null)
    {
        var root = input["meta"].S("format") == "canvaswebtool-portable" ? Portable.Import(input) : input.Clone();
        if (root.S("format") != "canvaswebtool-document" || root.N("version", 1) != 1 || root["document"] is not JsonObject body) throw new InvalidDataException("Unsupported Canvas document. Expected a version 1 .cvdoc or portable JSON file.");
        if (body["elements"] is JsonArray old && old.Count > 0) throw new InvalidDataException("This legacy node format must first be converted with the original application.");
        foreach (var canvasBody in CanvasBodies(body))
        {
        foreach (var type in Plural.Keys)
        {
            canvasBody[Plural[type]] ??= new JsonArray();
            if (canvasBody[Plural[type]] is not JsonArray a || a.Any(x => x is not JsonObject)) throw new InvalidDataException($"Invalid {Plural[type]} collection.");
            var ids = new HashSet<double>();
            var next = a.OfType<JsonObject>().Select(x => x.N("id")).DefaultIfEmpty().Max() + 1;
            foreach (var e in a.OfType<JsonObject>())
            {
                var id = e.N("id");
                if (id <= 0) e["id"] = id = next++;
                if (!ids.Add(id)) throw new InvalidDataException($"Duplicate {type} id {id}.");
                foreach (var field in new[] { "x", "y", "w", "h", "x1", "y1", "x2", "y2", "fontSize", "borderWidth", "lineWidth", "headSize" })
                    if (e[field] != null && (!Json.TryNumber(e[field],out var d) || Math.Abs(d) > 1e9)) throw new InvalidDataException($"Invalid {type} {field}.");
                if ((e["w"] != null && e.N("w") <= 0) || (e["h"] != null && e.N("h") <= 0)) throw new InvalidDataException("Entity dimensions must be positive.");
            }
        }
        canvasBody["viewport"] ??= new JsonObject(); canvasBody["settings"] ??= new JsonObject();
        var vp = canvasBody["viewport"].Obj(); vp["scale"] = Math.Clamp(vp.N("scale", 1), .05, 5);
        // Resolve assets into memory before adopting the new document; the live image is never stripped on save.
        if (path != null)
            foreach (var shape in ((JsonArray)canvasBody["shapes"]!).OfType<JsonObject>())
                if (shape["image"] is JsonObject image && image.S("assetPath") is { Length: > 0 } name)
                {
                    if (Path.GetFileName(name) != name || name.Contains('\\') || name.Contains('/')) throw new InvalidDataException("Invalid image asset path.");
                    var assetPath = Path.Combine(AssetDir(path), name);
                    if (!File.Exists(assetPath)) throw new FileNotFoundException($"Missing image asset: {name}", assetPath);
                    image["src"] = DataUri(assetPath); image.Remove("assetPath");
                }
        }
        Root = root; canvasPath.Clear(); FilePath = path; Selection.Clear(); undo.Clear(); redo.Clear(); saved = Snapshot(); Notify();
    }
    public void Open(string path) => Load(JsonNode.Parse(File.ReadAllText(path)).Obj(), Path.GetFullPath(path));
    public void Replace(JsonObject input,bool preservePath=true,bool reparent=true)
    {
        var validated=new Document();validated.Load(input);
        Edit(()=>{Root=validated.Root.Clone();Selection.RemoveWhere(id=>Find(id)==null);if(!preservePath)FilePath=null;},reparent);
    }
    public static string AssetDir(string path) => Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path))!, Path.GetFileNameWithoutExtension(path) + "_assets");
    public static string DataUri(string path) => $"data:image/{Path.GetExtension(path).ToLowerInvariant() switch { ".jpg" => "jpeg", ".svg" => "svg+xml", var ext => ext.TrimStart('.') }};base64,{Convert.ToBase64String(File.ReadAllBytes(path))}";
    public void Save(string path)
    {
        path = Path.GetFullPath(path);
        if (Path.GetExtension(path).ToLowerInvariant() is not (".cvdoc" or ".json")) throw new InvalidDataException("Use a .cvdoc or .json filename.");
        var copy = Root.Clone();
        var meta = copy["metadata"].Obj(); copy["metadata"] = null; copy["metadata"] = meta; meta["created"] ??= DateTime.UtcNow.ToString("O"); meta["modified"] = DateTime.UtcNow.ToString("O");
        foreach (var shape in CanvasBodies(copy["document"].Obj()).SelectMany(b => ((JsonArray)b["shapes"]!).OfType<JsonObject>()))
        {
            if (shape["image"] is not JsonObject image || !image.S("src").StartsWith("data:")) continue;
            var src = image.S("src"); var comma = src.IndexOf(',');
            if (comma < 0 || !src[..comma].EndsWith(";base64")) throw new InvalidDataException("Unsupported image data URL.");
            var bytes = Convert.FromBase64String(src[(comma + 1)..]);
            var ext = src[5..comma].Split(';')[0].Split('/').Last() switch { "jpeg" => "jpg", "svg+xml" => "svg", var e => e };
            if (!new[] { "png", "jpg", "gif", "webp", "bmp", "svg", "avif" }.Contains(ext)) throw new InvalidDataException("Unsupported image format.");
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))[..20].ToLowerInvariant();
            var name = $"img_{hash}.{ext}";
            Directory.CreateDirectory(AssetDir(path));
            File.WriteAllBytes(Path.Combine(AssetDir(path), name), bytes);
            image.Remove("src"); image["assetPath"] = name;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, copy.ToJsonString(Json.Options)); File.Move(temporary, path, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        FilePath = path; saved = Snapshot(); Notify();
    }
    public Entity Create(string type, Point p, Size? size = null, string shape = "rectangle")
    {
        if (!Plural.ContainsKey(type)) throw new ArgumentException("Unknown entity type.");
        if (type == "shape" && !new[] { "rectangle", "circle", "triangle", "diamond" }.Contains(shape)) throw new ArgumentException("Unknown shape type.");
        var id = List(type).OfType<JsonObject>().Select(d => d.N("id")).DefaultIfEmpty().Max() + 1;
        var d = new JsonObject { ["id"] = id, ["locked"] = false };
        if (type is "shape" or "textBox")
        {
            d["x"] = p.X; d["y"] = p.Y; d["w"] = size?.Width ?? (type == "textBox" ? 240 : 120); d["h"] = size?.Height ?? (type == "textBox" ? 160 : 80);
            d["parentId"] = null; d["parentType"] = null;
            d["color"] = type == "shape" ? "#2b2b2b" : "#1a1a1a"; d["borderColor"] = type == "shape" ? "#6bb5ff" : "#444444";
            if (type == "shape") { d["shapeType"] = shape; d["borderWidth"] = 2; d["cornerRadius"] = shape == "rectangle" ? 4 : 0; }
            else { d["title"] = ""; d["text"] = ""; d["fontSize"] = 14; d["textColor"] = "#dddddd"; d["titleColor"] = "#e7e7e7"; }
        }
        else { d["color"] = "#6bb5ff"; d["x1"] = p.X; d["y1"] = p.Y; d["x2"] = p.X + 120; d["y2"] = p.Y; d["lineWidth"] = 2; d["headSize"] = 14; }
        List(type).Add(d); return new(type, d);
    }
    public void Reparent()
    {
        var boxes = Entities.Where(e => e.IsBox).ToList();
        foreach (var e in boxes)
        {
            var r = e.Bounds;
            var parent = boxes.Where(p => p.Id != e.Id && p.Bounds.Width * p.Bounds.Height > r.Width * r.Height && p.Bounds.Contains(r)).OrderBy(p => p.Bounds.Width * p.Bounds.Height).FirstOrDefault();
            e.Data["parentId"] = parent?.Data["id"]?.DeepClone(); e.Data["parentType"] = parent?.Type;
        }
    }
    public int Depth(Entity e)
    {
        var seen = new HashSet<string>(); var depth = 0;
        while (e.Data["parentId"] != null && seen.Add(e.Id))
        {
            var parent = Find(Prefix.GetValueOrDefault(e.Data.S("parentType"), "") + "-" + e.Data.N("parentId").ToString(CultureInfo.InvariantCulture));
            if (parent == null) break; e = parent; depth++;
        }
        return depth;
    }
    public IEnumerable<Entity> MovingSelection()
    {
        var result = Entities.Where(e => Selection.Contains(e.Id) && !e.Locked).ToList();
        foreach (var box in Entities.Where(e => e.IsBox && !e.Locked))
            if (!result.Contains(box) && result.Any(p => p.IsBox && p.Bounds.Contains(box.Bounds) && p.Bounds != box.Bounds)) result.Add(box);
        return result;
    }
    public void DeleteSelection()
    {
        Edit(() => {
            var deleted = Entities.Where(e => Selection.Contains(e.Id) && !e.Locked).ToList();
            var old = new Dictionary<string, List<Entity>> { ["shape"] = Entities.Where(e => e.Type == "shape").ToList(), ["textBox"] = Entities.Where(e => e.Type == "textBox").ToList() };
            foreach (var e in deleted) List(e.Type).Remove(e.Data);
            foreach (var line in Entities.Where(e => !e.IsBox).ToList())
            {
                if (line.Type == "connection")
                {
                    var a = AtOld("textBox", line.Data["from"]); var b = AtOld("textBox", line.Data["to"]);
                    if (a == null || b == null || deleted.Contains(a) || deleted.Contains(b)) { List("connection").Remove(line.Data); continue; }
                    line.Data["from"] = List("textBox").IndexOf(a.Data); line.Data["to"] = List("textBox").IndexOf(b.Data);
                }
                else foreach (var end in new[] { "From", "To" })
                {
                    var type = line.Data.S("connected" + end + "Type"); var target = AtOld(type, line.Data["connected" + end]);
                    line.Data["connected" + end] = target != null && !deleted.Contains(target) ? JsonValue.Create(List(type).IndexOf(target.Data)) : null;
                    if (line.Data["connected" + end] == null) line.Data["connected" + end + "Type"] = null;
                }
            }
            Selection.Clear();
            Entity? AtOld(string t, JsonNode? n) => old.TryGetValue(t, out var list) && n is JsonValue v && v.TryGetValue<int>(out var i) && i >= 0 && i < list.Count ? list[i] : null;
        });
    }
    public Entity Connect(Entity a, Entity b, string kind, string label = "")
    {
        if (a.Id == b.Id || !a.IsBox || !b.IsBox) throw new ArgumentException("Connections require two different boxes or shapes.");
        if (kind is not ("arrow" or "connector" or "connection")) throw new ArgumentException("Unknown connection kind.");
        if (kind == "connection" && (a.Type != "textBox" || b.Type != "textBox")) throw new ArgumentException("Bézier connections require two text boxes.");
        if (kind == "connection")
        {
            var existing = Entities.FirstOrDefault(e => e.Type == kind && At("textBox", e.Data["from"])?.Id == a.Id && At("textBox", e.Data["to"])?.Id == b.Id);
            if (existing != null) return existing;
        }
        var line = Create(kind, a.Bounds.Center);
        if (kind == "connection") { line.Data["from"] = List("textBox").IndexOf(a.Data); line.Data["to"] = List("textBox").IndexOf(b.Data); line.Data["text"] = label; }
        else { Attach(line, "From", a); Attach(line, "To", b); line.Data["x2"] = b.Bounds.Center.X; line.Data["y2"] = b.Bounds.Center.Y; }
        return line;
    }
    public void Attach(Entity line, string end, Entity? box)
    {
        line.Data["connected" + end] = box == null ? null : JsonValue.Create(List(box.Type).IndexOf(box.Data));
        line.Data["connected" + end + "Type"] = box?.Type;
    }
    public static void Move(Entity e, Vector delta)
    {
        foreach (var f in e.IsBox ? new[] { "x", "y" } : new[] { "x1", "y1", "x2", "y2" })
            e.Data[f] = e.Data.N(f) + (f.StartsWith('x') ? delta.X : delta.Y);
    }
    public JsonObject CopySelection()
    {
        var portable = Portable.Export(this); var entities = portable["entities"].Obj();
        var selected = MovingSelection().Select(e => e.Id).ToHashSet();
        foreach (var list in entities.Select(p => p.Value).OfType<JsonArray>())
            foreach (var item in list.OfType<JsonObject>().ToList())
            {
                var internalLink = item.S("from") is { Length: > 0 } f && selected.Contains(f) && selected.Contains(item.S("to"));
                if (!selected.Contains(item.S("id")) && !internalLink) list.Remove(item);
            }
        portable["canvasClipboard"] = true; return portable;
    }
    public void Paste(JsonObject portable, Vector delta)
    {
        var incoming = new Document(); incoming.Load(portable); var mapping = new Dictionary<string, Entity>();
        Edit(() => {
            Selection.Clear();
            foreach (var e in incoming.Entities.Where(e => e.IsBox))
            {
                var clone = Create(e.Type, e.Bounds.Position); var id = clone.Data["id"]!.DeepClone();
                foreach (var p in e.Data) clone.Data[p.Key] = p.Value?.DeepClone(); clone.Data["id"] = id;
                Move(clone, delta); mapping[e.Id] = clone; Selection.Add(clone.Id);
            }
            foreach (var e in incoming.Entities.Where(e => !e.IsBox))
            {
                Entity clone;
                if (e.Type == "connection")
                {
                    var a = incoming.At("textBox", e.Data["from"]); var b = incoming.At("textBox", e.Data["to"]);
                    if (a == null || b == null || !mapping.ContainsKey(a.Id) || !mapping.ContainsKey(b.Id)) continue;
                    clone = Connect(mapping[a.Id], mapping[b.Id], e.Type, e.Data.S("text")); clone.Data["color"] = e.Data["color"]?.DeepClone();
                }
                else
                {
                    clone = Create(e.Type, new()); var id = clone.Data["id"]!.DeepClone();
                    foreach (var p in e.Data) clone.Data[p.Key] = p.Value?.DeepClone(); clone.Data["id"] = id; Move(clone, delta);
                    foreach (var end in new[] { "From", "To" })
                    {
                        var target = incoming.At(e.Data.S("connected" + end + "Type"), e.Data["connected" + end]);
                        Attach(clone, end, target != null ? mapping.GetValueOrDefault(target.Id) : null);
                    }
                }
                Selection.Add(clone.Id);
            }
        });
    }
}

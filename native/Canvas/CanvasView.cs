using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Media.Imaging;

namespace CanvasNative;

public sealed class CanvasView : Control
{
    public Document Document { get; set; } = new();
    public string Tool { get; set; }="cursor";
    public bool Snap { get; set; }
    public bool SpaceDown { get; set; }
    public bool IsInteracting=>mode.Length>0;
    public string BackgroundColor { get; set; }="#101010";
    public string GridColor { get; set; }="#191919";
    public event Action<Entity,string>? EditRequested;
    public new event Action<Point>? ContextRequested;
    public event Action? InteractionFinished;
    public event Action<Entity>? CanvasRequested;
    public double Scale=>Math.Clamp(Document.Viewport.N("scale",1),.05,5);
    public Point Offset=>new(Document.Viewport.N("offsetX"),Document.Viewport.N("offsetY"));
    public Point World(Point p)=>new((p.X-Offset.X)/Scale,(p.Y-Offset.Y)/Scale);
    public Point Screen(Point p)=>new(p.X*Scale+Offset.X,p.Y*Scale+Offset.Y);
    public Point Center=>World(new(Bounds.Width/2,Bounds.Height/2));
    private string? before;
    private string mode="";
    private Point press,last,origin;
    private Entity? active,from;
    private int handle=-1;
    private Rect originalBounds;
    private readonly Dictionary<string,JsonObject> starting=[];
    private readonly Dictionary<string,Bitmap?> images=[];
    private readonly Dictionary<string,List<(TextBlock Block,double Y)>> layouts=[];
    private Rect? marquee;
    private Entity? preview;
    private bool moved;
    private readonly Dictionary<int,Point> touches=[];
    private double pinchDistance;
    private Point pinchCenter;
    public CanvasView()
    {
        Focusable=true;ClipToBounds=true;
        PointerPressed+=Press;PointerMoved+=Move;PointerReleased+=Release;
        PointerCaptureLost+=(_,_)=>{if(mode.Length>0)CancelInteraction();};
        PointerWheelChanged+=Wheel;
    }
    public void ClearCaches(){foreach(var bitmap in images.Values)bitmap?.Dispose();images.Clear();layouts.Clear();}
    public void CancelInteraction()
    {
        var snapshot=before;before=null;mode="";preview=null;marquee=null;active=null;from=null;starting.Clear();touches.Clear();if(snapshot!=null)Document.Restore(snapshot);InvalidateVisual();
    }
    public void Zoom(double factor,Point anchor)
    {
        var world=World(anchor);var next=Math.Clamp(Scale*factor,.05,5);Document.Viewport["scale"]=next;Document.Viewport["offsetX"]=anchor.X-world.X*next;Document.Viewport["offsetY"]=anchor.Y-world.Y*next;InvalidateVisual();
    }
    public void FocusContent(bool all=false)
    {
        var entities=Document.Entities.Where(e=>all||Document.Selection.Count==0||Document.Selection.Contains(e.Id)).ToList();if(entities.Count==0)return;
        var bounds=entities.Select(e=>e.IsBox?e.Bounds:new Rect(GeometryMath.Endpoints(Document,e).A,GeometryMath.Endpoints(Document,e).B)).Aggregate((a,b)=>a.Union(b));
        var scale=Math.Clamp(Math.Min((Bounds.Width-100)/Math.Max(20,bounds.Width),(Bounds.Height-100)/Math.Max(20,bounds.Height)),.05,5);
        Document.Viewport["scale"]=scale;Document.Viewport["offsetX"]=Bounds.Width/2-bounds.Center.X*scale;Document.Viewport["offsetY"]=Bounds.Height/2-bounds.Center.Y*scale;InvalidateVisual();
    }
    public Entity? Hit(Point world,bool boxesOnly=false)
    {
        var box=Document.Entities.Where(e=>e.IsBox).OrderBy(Document.Depth).ThenByDescending(e=>e.Bounds.Width*e.Bounds.Height).Reverse().FirstOrDefault(e=>GeometryMath.Hit(e,world));
        return box??(boxesOnly?null:Document.Entities.Where(e=>!e.IsBox).Reverse().FirstOrDefault(e=>GeometryMath.LineDistance(Document,e,world)<8/Scale));
    }
    private Point Snapped(Point p)=>Snap?new(Math.Round(p.X/10)*10,Math.Round(p.Y/10)*10):p;
    private void Press(object? sender,PointerPressedEventArgs e)
    {
        Focus();var point=e.GetPosition(this);var properties=e.GetCurrentPoint(this).Properties;
        if(e.Pointer.Type==PointerType.Touch)
        {
            touches[e.Pointer.Id]=point;e.Pointer.Capture(this);
            if(touches.Count==2){if(before!=null)Document.Restore(before);before=null;mode="pinch";preview=null;marquee=null;var p=touches.Values.ToArray();pinchDistance=(p[1]-p[0]).Length();pinchCenter=new((p[0].X+p[1].X)/2,(p[0].Y+p[1].Y)/2);return;}
        }
        press=last=point;origin=Snapped(World(point));moved=false;before=null;
        if(properties.IsMiddleButtonPressed||properties.IsRightButtonPressed||SpaceDown||(e.Pointer.Type==PointerType.Touch&&Tool=="cursor")){mode=properties.IsRightButtonPressed?"rightpan":"pan";e.Pointer.Capture(this);return;}
        if(!properties.IsLeftButtonPressed&&e.Pointer.Type!=PointerType.Touch)return;
        if(Tool!="cursor")
        {
            mode="create";from=Hit(origin,true);e.Pointer.Capture(this);e.Handled=true;return;
        }
        if(Document.Selection.Count==1)
        {
            var selected=Document.Find(Document.Selection.First());
            if(selected is {Locked:false})
            {
                if(selected.IsBox)
                {
                    handle=Array.FindIndex(GeometryMath.Handles(selected.Bounds),p=>(Screen(p)-point).Length()<=7);
                    if(handle>=0){active=selected;originalBounds=selected.Bounds;before=Document.Snapshot();mode="resize";e.Pointer.Capture(this);return;}
                }
                else if(selected.Type!="connection")
                {
                    var(a,b)=GeometryMath.Endpoints(Document,selected);handle=(Screen(a)-point).Length()<12?0:(Screen(b)-point).Length()<12?1:-1;
                    if(handle>=0){active=selected;before=Document.Snapshot();mode="endpoint";e.Pointer.Capture(this);return;}
                }
            }
        }
        var hit=Hit(World(point));
        if(hit!=null)
        {
            if(hit.Data["subCanvas"] is JsonObject&&(e.ClickCount==2||World(point).Y>=hit.Bounds.Bottom-30)){CanvasRequested?.Invoke(hit);return;}
            if(e.ClickCount==2){EditRequested?.Invoke(hit,hit.Type=="textBox"?(World(point).Y-hit.Bounds.Y<28&&!string.IsNullOrEmpty(hit.Data.S("title"))?"title":"text"):"text");return;}
            if(e.KeyModifiers.HasFlag(KeyModifiers.Shift)){if(!Document.Selection.Add(hit.Id))Document.Selection.Remove(hit.Id);}
            else if(!Document.Selection.Contains(hit.Id)){Document.Selection.Clear();Document.Selection.Add(hit.Id);}
            Document.Notify();before=Document.Snapshot();starting.Clear();foreach(var entity in Document.MovingSelection())starting[entity.Id]=entity.Data.Clone();mode="move";
        }
        else
        {
            if(!e.KeyModifiers.HasFlag(KeyModifiers.Shift))Document.Selection.Clear();starting.Clear();foreach(var id in Document.Selection)starting[id]=new();mode="marquee";marquee=new(World(point),new Size(0,0));Document.Notify();
        }
        e.Pointer.Capture(this);e.Handled=true;
    }
    private void Move(object? sender,PointerEventArgs e)
    {
        var point=e.GetPosition(this);var world=Snapped(World(point));
        if(e.Pointer.Type==PointerType.Touch&&touches.ContainsKey(e.Pointer.Id))touches[e.Pointer.Id]=point;
        if(mode=="pinch"&&touches.Count==2)
        {
            var p=touches.Values.ToArray();var distance=(p[1]-p[0]).Length();var center=new Point((p[0].X+p[1].X)/2,(p[0].Y+p[1].Y)/2);
            if(pinchDistance>1)Zoom(distance/pinchDistance,pinchCenter);Document.Viewport["offsetX"]=Offset.X+center.X-pinchCenter.X;Document.Viewport["offsetY"]=Offset.Y+center.Y-pinchCenter.Y;pinchCenter=center;pinchDistance=distance;InvalidateVisual();return;
        }
        if(mode.Length==0){Cursor=new Cursor(Tool=="cursor"?StandardCursorType.Arrow:StandardCursorType.Cross);return;}
        if((point-press).Length()>3)moved=true;
        if(mode is "pan" or "rightpan"){var delta=point-last;Document.Viewport["offsetX"]=Offset.X+delta.X;Document.Viewport["offsetY"]=Offset.Y+delta.Y;}
        else if(mode=="move"&&moved)
        {
            var delta=world-origin;
            foreach(var(id,data)in starting){var entity=Document.Find(id);if(entity==null||entity.Type=="connection")continue;foreach(var f in entity.IsBox?new[]{"x","y"}:new[]{"x1","y1","x2","y2"})entity.Data[f]=data.N(f)+(f.StartsWith('x')?delta.X:delta.Y);}
        }
        else if(mode=="resize"&&active!=null)
        {
            var r=originalBounds;var left=r.Left;var top=r.Top;var right=r.Right;var bottom=r.Bottom;
            if(handle is 0 or 6 or 7)left=Math.Min(world.X,right-20);if(handle is 2 or 3 or 4)right=Math.Max(world.X,left+20);
            if(handle is 0 or 1 or 2)top=Math.Min(world.Y,bottom-20);if(handle is 4 or 5 or 6)bottom=Math.Max(world.Y,top+20);
            if(e.KeyModifiers.HasFlag(KeyModifiers.Shift)){var ratio=r.Width/r.Height;var width=right-left;var height=bottom-top;if(width/height>ratio)height=width/ratio;else width=height*ratio;if(handle is 0 or 6 or 7)left=right-width;else right=left+width;if(handle is 0 or 1 or 2)top=bottom-height;else bottom=top+height;}
            active.Data["x"]=left;active.Data["y"]=top;active.Data["w"]=right-left;active.Data["h"]=bottom-top;
        }
        else if(mode=="endpoint"&&active!=null)
        {
            var suffix=handle==0?"1":"2";active.Data["x"+suffix]=world.X;active.Data["y"+suffix]=world.Y;Document.Attach(active,handle==0?"From":"To",Hit(world,true));
        }
        else if(mode=="marquee")marquee=new Rect(origin,world);
        else if(mode=="create")
        {
            var type=Tool is "arrow" or "connector"?Tool:Tool is "text" or "subCanvas"?"textBox":"shape";var r=new Rect(origin,world);var data=new JsonObject{["x"]=r.X,["y"]=r.Y,["w"]=Math.Max(1,r.Width),["h"]=Math.Max(1,r.Height),["x1"]=origin.X,["y1"]=origin.Y,["x2"]=world.X,["y2"]=world.Y,["shapeType"]=Tool,["color"]="#2b2b2b",["borderColor"]="#6bb5ff"};
            preview=new(type,data);
        }
        last=point;InvalidateVisual();
    }
    private void Release(object? sender,PointerReleasedEventArgs e)
    {
        var ended=mode;mode="";var point=e.GetPosition(this);var world=Snapped(World(point));touches.Remove(e.Pointer.Id);
        if(ended=="pinch"){touches.Clear();before=null;InvalidateVisual();e.Pointer.Capture(null);return;}
        if(ended=="rightpan"&&!moved)ContextRequested?.Invoke(point);
        else if(ended=="marquee"&&marquee is Rect area)
        {
            foreach(var box in Document.Entities.Where(x=>x.IsBox&&area.Contains(x.Bounds)))Document.Selection.Add(box.Id);
            foreach(var line in Document.Entities.Where(x=>!x.IsBox)){var(a,b)=GeometryMath.Endpoints(Document,line);if(area.Contains(a)&&area.Contains(b))Document.Selection.Add(line.Id);}
            Document.Notify();
        }
        else if(ended=="create")
        {
            var tool=Tool;Document.Edit(()=>{
                Entity created;
                if(tool is "arrow" or "connector")
                {
                    var target=Hit(world,true);created=Document.Create(tool,origin);created.Data["x2"]=world.X+(moved?0:120);created.Data["y2"]=world.Y;Document.Attach(created,"From",from);if(target?.Id!=from?.Id)Document.Attach(created,"To",target);
                }
                else
                {
                    var area=new Rect(origin,world);var size=moved?new Size(Math.Max(20,area.Width),Math.Max(20,area.Height)):tool=="subCanvas"?new Size(280,180):tool=="text"?new Size(240,160):tool=="image"?new Size(280,220):new Size(120,80);
                    if(e.KeyModifiers.HasFlag(KeyModifiers.Shift)&&tool!="text")size=new(Math.Max(size.Width,size.Height),Math.Max(size.Width,size.Height));
                    var p=moved?area.Position:new Point(origin.X-size.Width/2,origin.Y-size.Height/2);created=tool=="subCanvas"?Document.CreateSubCanvas(p,size):Document.Create(tool=="text"?"textBox":"shape",p,size,tool is "text" or "image"?"rectangle":tool);
                    if(tool=="image")created.Data["color"]="#1e1e1e";
                }
                Document.Selection.Clear();Document.Selection.Add(created.Id);
            });
        }
        else if(before!=null)Document.Commit(before);
        before=null;preview=null;marquee=null;active=null;from=null;starting.Clear();e.Pointer.Capture(null);InvalidateVisual();InteractionFinished?.Invoke();e.Handled=true;
    }
    private void Wheel(object? sender,PointerWheelEventArgs e)
    {
        if(e.KeyModifiers.HasFlag(KeyModifiers.Control))Zoom(Math.Pow(1.1,e.Delta.Y),e.GetPosition(this));
        else{Document.Viewport["offsetX"]=Offset.X+e.Delta.X*40+(e.KeyModifiers.HasFlag(KeyModifiers.Shift)?e.Delta.Y*40:0);if(!e.KeyModifiers.HasFlag(KeyModifiers.Shift))Document.Viewport["offsetY"]=Offset.Y+e.Delta.Y*40;InvalidateVisual();}
        e.Handled=true;
    }
    public override void Render(DrawingContext context)
    {
        base.Render(context);context.FillRectangle(RichText.Brush(BackgroundColor),new Rect(Bounds.Size));DrawGrid(context);
        using(context.PushTransform(new Matrix(Scale,0,0,Scale,Offset.X,Offset.Y)))
        {
            foreach(var e in Document.Entities.Where(e=>!e.IsBox))DrawLine(context,e);
            var view=new Rect(World(new(0,0)),World(new(Bounds.Width,Bounds.Height))).Inflate(50/Scale);
            foreach(var e in Document.Entities.Where(e=>e.IsBox&&e.Bounds.Intersects(view)).OrderBy(Document.Depth).ThenByDescending(e=>e.Bounds.Width*e.Bounds.Height))DrawBox(context,e);
            if(preview!=null){using(context.PushOpacity(.5)){if(preview.IsBox)DrawBox(context,preview);else DrawLine(context,preview);}}
            if(marquee is Rect area)context.DrawRectangle(new SolidColorBrush(Color.Parse("#226bb5ff")),new Pen(RichText.Brush("#6bb5ff"),1/Scale),area);
        }
    }
    private void DrawGrid(DrawingContext context)
    {
        foreach(var(s,w,min,peak,max)in new(double,double,double,double,double)[]{(10,.6,8,24,70),(40,.8,10,28,80),(200,1.1,16,60,180),(1000,1.4,24,100,320)})
        {
            var pixels=s*Scale;if(pixels<=min||pixels>=max)continue;var t=pixels<peak?(pixels-min)/(peak-min):(pixels-peak)/(max-peak);var opacity=pixels<peak?t*t*(3-2*t):1-t*t*(3-2*t);
            var pen=new Pen(RichText.Brush(GridColor),2*w);
            using(context.PushOpacity(opacity))
            {
                for(var x=Offset.X%pixels;x<Bounds.Width;x+=pixels)context.DrawLine(pen,new(x,0),new(x,Bounds.Height));
                for(var y=Offset.Y%pixels;y<Bounds.Height;y+=pixels)context.DrawLine(pen,new(0,y),new(Bounds.Width,y));
            }
        }
    }
    private List<(TextBlock Block,double Y)> TextLayout(string text,double width,double size,string color)
    {
        var key=text+"|"+width+"|"+size+"|"+color;if(layouts.TryGetValue(key,out var value))return value;
        if(layouts.Count>600)layouts.Clear();return layouts[key]=RichText.Layout(text,width,size,color);
    }
    private void DrawBox(DrawingContext context,Entity e)
    {
        var d=e.Data;var r=e.Bounds;var radius=d.N("cornerRadius",e.Type=="textBox"?6:4);var brush=RichText.Brush(d.S("color",e.Type=="textBox"?"#1a1a1a":"#2b2b2b"));var pen=new Pen(RichText.Brush(d.S("borderColor",e.Type=="textBox"?"#444":"#6bb5ff")),Math.Clamp(d.N("borderWidth",e.Type=="textBox"?1.5:2),0,200));
        Geometry? clip=null;
        if(e.Type=="shape"&&d.S("shapeType")=="circle"){clip=new EllipseGeometry(r);context.DrawGeometry(brush,pen,clip);}
        else if(e.Type=="shape"&&d.S("shapeType") is "triangle" or "diamond"){clip=GeometryMath.Polygon(GeometryMath.Vertices(e));context.DrawGeometry(brush,pen,clip);}
        else context.DrawRectangle(brush,pen,r,radius,radius);
        if(d["image"] is JsonObject image)
        {
            var source=image.S("src");
            if(!images.TryGetValue(source,out var bitmap))
            {
                try{if(!source.StartsWith("data:"))throw new InvalidDataException();var bytes=Convert.FromBase64String(source[(source.IndexOf(',')+1)..]);bitmap=new Bitmap(new MemoryStream(bytes));}catch{bitmap=null;}
                images[source]=bitmap;
            }
            if(bitmap!=null)
            {
                var target=new Rect(r.X+image.N("x",10),r.Y+image.N("y",10),Math.Max(1,image.N("w",r.Width-20)),Math.Max(1,image.N("h",r.Height-20)));
                if(image.B("keepRatio")){var ratio=Math.Min(target.Width/bitmap.Size.Width,target.Height/bitmap.Size.Height);var size=bitmap.Size*ratio;target=new(target.Center.X-size.Width/2,target.Center.Y-size.Height/2,size.Width,size.Height);}
                using(context.PushGeometryClip(clip??new RectangleGeometry(r,radius,radius)))context.DrawImage(bitmap,new Rect(bitmap.Size),target);
            }
            else if(source.Length>0)DrawText(context,"Image unavailable",r.Position+new Vector(8,8),r.Width-16,14,"#999",r.Height-16);
        }
        if(e.Type=="textBox")
        {
            using(context.PushClip(new RoundedRect(r,6)))
            {
                double top=r.Y+8;
                if(d.S("title") is {Length:>0} title)
                {
                    var c=(brush as SolidColorBrush)!.Color;var dark=Color.FromArgb(c.A,(byte)Math.Round(c.R*.6),(byte)Math.Round(c.G*.6),(byte)Math.Round(c.B*.6));context.FillRectangle(new SolidColorBrush(dark),new Rect(r.X,r.Y,r.Width,34));
                    var titleBlock=RichText.Inline("**"+title+"**",15,d.S("titleColor","#e7e7e7"));titleBlock.TextAlignment=TextAlignment.Center;titleBlock.Measure(new(Math.Max(1,r.Width-16),double.PositiveInfinity));titleBlock.Arrange(new(0,0,Math.Max(1,r.Width-16),titleBlock.DesiredSize.Height));
                    using(context.PushTransform(Matrix.CreateTranslation(r.X+8,r.Y+8)))titleBlock.Render(context);top=r.Y+39.5;
                }
                var isCanvas=d["subCanvas"] is JsonObject;
                var text=RichText.Markdown(d);var bottom=isCanvas?34:8;if(text.Length==0)DrawText(context,isCanvas?"Add a description in the sidebar":"Double-click to edit",new(r.X+8,top),r.Width-16,d.N("fontSize",14),"#777",Math.Max(0,r.Bottom-top-bottom));
                else DrawText(context,text,new(r.X+8,top),r.Width-16,d.N("fontSize",14),d.S("textColor","#ddd"),Math.Max(0,r.Bottom-top-bottom));
                if(isCanvas){var child=d["subCanvas"].Obj();var count=Document.Plural.Values.Sum(k=>(child[k] as JsonArray)?.Count??0);context.DrawLine(new Pen(RichText.Brush("#6bb5ff"),.5),new(r.X+10,r.Bottom-30),new(r.Right-10,r.Bottom-30));DrawText(context,$"▣  {count} objects     Open canvas →",new(r.X+10,r.Bottom-24),r.Width-20,11,"#6bb5ff",20);}
            }
        }
        if(Document.Selection.Contains(e.Id))
        {
            context.DrawRectangle(null,new Pen(RichText.Brush("#f0c800"),2/Scale),r.Inflate(1/Scale));
            if(!e.Locked)foreach(var point in GeometryMath.Handles(r))context.DrawRectangle(RichText.Brush("#111"),new Pen(RichText.Brush("#6bb5ff"),1/Scale),new Rect(point-new Vector(3/Scale,3/Scale),new Size(6/Scale,6/Scale)));
        }
    }
    private void DrawText(DrawingContext context,string text,Point p,double width,double size,string color,double maxHeight)
    {if(width<=0||maxHeight<=0)return;using(context.PushClip(new Rect(p,new Size(width,maxHeight))))RichText.Draw(context,TextLayout(text,width,Math.Clamp(size,1,500),color),p,maxHeight);}
    private void DrawLine(DrawingContext context,Entity e)
    {
        var d=e.Data;var(a,b)=GeometryMath.Endpoints(Document,e);var brush=RichText.Brush(d.S("color","#6bb5ff"));var pen=new Pen(brush,Math.Clamp(d.N("lineWidth",2),.1,200));
        if(e.Type=="connection")
        {
            var from=Document.At("textBox",d["from"]);var to=Document.At("textBox",d["to"]);if(from==null||to==null)return;var(c1,c2)=GeometryMath.Controls(a,b,from.Bounds,to.Bounds);var g=new StreamGeometry();using(var p=g.Open()){p.BeginFigure(a,false);p.CubicBezierTo(c1,c2,b);p.EndFigure(false);}context.DrawGeometry(null,pen,g);
            if(d.S("text") is {Length:>0} label){var mid=GeometryMath.Bezier(a,c1,c2,b,.5);var block=RichText.Inline(label,13,"#ddd");block.Measure(new(300,50));var r=new Rect(mid.X-block.DesiredSize.Width/2-8,mid.Y-12,block.DesiredSize.Width+16,26);context.DrawRectangle(RichText.Brush("#202020"),new Pen(brush,1),r,12,12);DrawText(context,label,r.Position+new Vector(8,4),r.Width-16,13,"#ddd",20);}
        }
        else
        {
            context.DrawLine(pen,a,b);
            if(e.Type=="arrow"&&(b-a).Length()>.01){var angle=Math.Atan2(b.Y-a.Y,b.X-a.X);var length=Math.Clamp(d.N("headSize",14),0,200);var head=GeometryMath.Polygon(new[]{b,new Point(b.X-length*Math.Cos(angle-.5),b.Y-length*Math.Sin(angle-.5)),new Point(b.X-length*Math.Cos(angle+.5),b.Y-length*Math.Sin(angle+.5))});context.DrawGeometry(brush,null,head);}
        }
        if(Document.Selection.Contains(e.Id))foreach(var point in new[]{a,b})context.DrawEllipse(RichText.Brush("#111"),new Pen(RichText.Brush("#6bb5ff"),1/Scale),point,5/Scale,5/Scale);
    }
}

using Avalonia;
using Avalonia.Media;
namespace CanvasNative;

public static class GeometryMath
{
    public static double Length(this Point p)=>Math.Sqrt(p.X*p.X+p.Y*p.Y);
    public static Point Edge(Entity box,Point toward)
    {
        var r=box.Bounds;var c=r.Center;var d=toward-c;if(Math.Abs(d.X)+Math.Abs(d.Y)<.001)return c;
        if(box.Data.S("shapeType")=="circle"){var t=1/Math.Sqrt(Math.Pow(d.X/(r.Width/2),2)+Math.Pow(d.Y/(r.Height/2),2));return c+d*t;}
        if(box.Data.S("shapeType") is "triangle" or "diamond")
        {
            var vertices=Vertices(box);double best=double.MaxValue;
            for(var i=0;i<vertices.Length;i++){var a=vertices[i];var v=vertices[(i+1)%vertices.Length]-a;var q=a-c;var cross=d.X*v.Y-d.Y*v.X;if(Math.Abs(cross)<1e-9)continue;var t=(q.X*v.Y-q.Y*v.X)/cross;var u=(q.X*d.Y-q.Y*d.X)/cross;if(t>=0&&u>=0&&u<=1)best=Math.Min(best,t);}
            if(best<double.MaxValue)return c+d*best;
        }
        return c+d*(1/Math.Max(Math.Abs(d.X)/(r.Width/2),Math.Abs(d.Y)/(r.Height/2)));
    }
    public static Point[] Vertices(Entity e){var r=e.Bounds;return e.Data.S("shapeType")=="triangle"?[new(r.Center.X,r.Top),r.BottomRight,r.BottomLeft]:[new(r.Center.X,r.Top),new(r.Right,r.Center.Y),new(r.Center.X,r.Bottom),new(r.Left,r.Center.Y)];}
    public static StreamGeometry Polygon(IEnumerable<Point> points){var p=points.ToArray();var g=new StreamGeometry();using(var c=g.Open()){c.BeginFigure(p[0],true);foreach(var v in p.Skip(1))c.LineTo(v);c.EndFigure(true);}return g;}
    public static bool Hit(Entity e,Point p)
    {
        var r=e.Bounds;if(!r.Contains(p))return false;if(e.Type!="shape")return true;
        if(e.Data.S("shapeType")=="circle")return Math.Pow((p.X-r.Center.X)/(r.Width/2),2)+Math.Pow((p.Y-r.Center.Y)/(r.Height/2),2)<=1;
        if(e.Data.S("shapeType") is "triangle" or "diamond"){var v=Vertices(e);bool inside=false;for(int i=0,j=v.Length-1;i<v.Length;j=i++)if((v[i].Y>p.Y)!=(v[j].Y>p.Y)&&p.X<(v[j].X-v[i].X)*(p.Y-v[i].Y)/(v[j].Y-v[i].Y)+v[i].X)inside=!inside;return inside;}
        return true;
    }
    public static(Point A,Point B) Endpoints(Document doc,Entity line)
    {
        var d=line.Data;var from=line.Type=="connection"?doc.At("textBox",d["from"]):doc.At(d.S("connectedFromType"),d["connectedFrom"]);var to=line.Type=="connection"?doc.At("textBox",d["to"]):doc.At(d.S("connectedToType"),d["connectedTo"]);
        var a=new Point(d.N("x1"),d.N("y1"));var b=new Point(d.N("x2"),d.N("y2"));if(from!=null)a=Edge(from,to?.Bounds.Center??b);if(to!=null)b=Edge(to,from?.Bounds.Center??a);return(a,b);
    }
    public static(Point C1,Point C2) Controls(Point a,Point b,Rect from,Rect to){var dist=Math.Min((b-a).Length()/2,80);return(a+Normal(a,from)*dist,b+Normal(b,to)*dist);}
    private static Vector Normal(Point p,Rect r){var distances=new[]{Math.Abs(p.X-r.Left),Math.Abs(p.X-r.Right),Math.Abs(p.Y-r.Top),Math.Abs(p.Y-r.Bottom)};return Array.IndexOf(distances,distances.Min())switch{0=>new(-1,0),1=>new(1,0),2=>new(0,-1),_=>new(0,1)};}
    public static Point Bezier(Point a,Point c1,Point c2,Point b,double t){var u=1-t;return new(u*u*u*a.X+3*u*u*t*c1.X+3*u*t*t*c2.X+t*t*t*b.X,u*u*u*a.Y+3*u*u*t*c1.Y+3*u*t*t*c2.Y+t*t*t*b.Y);}
    public static double Distance(Point p,Point a,Point b){var v=b-a;var length=v.X*v.X+v.Y*v.Y;var t=length<.0001?0:Math.Clamp(((p.X-a.X)*v.X+(p.Y-a.Y)*v.Y)/length,0,1);return(p-(a+v*t)).Length();}
    public static double LineDistance(Document doc,Entity line,Point p)
    {
        var(a,b)=Endpoints(doc,line);if(line.Type!="connection")return Distance(p,a,b);var from=doc.At("textBox",line.Data["from"]);var to=doc.At("textBox",line.Data["to"]);if(from==null||to==null)return double.MaxValue;
        var(c1,c2)=Controls(a,b,from.Bounds,to.Bounds);var best=double.MaxValue;var previous=a;for(var i=1;i<=40;i++){var next=Bezier(a,c1,c2,b,i/40.0);best=Math.Min(best,Distance(p,previous,next));previous=next;}return best;
    }
    public static Point[] Handles(Rect r)=>[r.TopLeft,new(r.Center.X,r.Top),r.TopRight,new(r.Right,r.Center.Y),r.BottomRight,new(r.Center.X,r.Bottom),r.BottomLeft,new(r.Left,r.Center.Y)];
}

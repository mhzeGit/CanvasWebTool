using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace CanvasNative;

/// <summary>Native text layouts for the original Markdown, legacy blocks and Tiptap JSON.</summary>
public static class RichText
{
    public static string Markdown(JsonObject data)
    {
        if(data.S("text") is {Length:>0} text)return text;
        if(data["content"] is JsonObject doc)return NodeMarkdown(doc).TrimEnd();
        if(data["blocks"] is JsonArray blocks)
            return string.Join("\n",blocks.OfType<JsonObject>().Select(b=>{
                var content=string.Concat((b["s"] as JsonArray??[]).OfType<JsonObject>().Select(s=>{
                    var value=s.S("t");if(s.B("b"))value="**"+value+"**";if(s.B("i"))value="_"+value+"_";if(s.B("u"))value="<u>"+value+"</u>";if(s.B("s")||s.B("st"))value="~~"+value+"~~";if(s.B("cd")||s.B("code"))value="`"+value+"`";var color=s.S("fc",s.S("c"));if(color.Length>0)value="{"+color+":"+value+"}";return value;
                }));
                return b.S("t") switch {"h1"=>"# "+content,"h2"=>"## "+content,"h3"=>"### "+content,"ul" or "li" or "bullet" or "bul"=>"- "+content,"ol" or "number" or "num"=>b.N("n",1)+". "+content,"quote" or "qt"=>"> "+content,"hr"=>"---","check" or "chk"=>"- ["+(b.B("checked")||b.B("c")?"x":" ")+"] "+content,_=>content};
            }));
        return "";
    }
    private static string NodeMarkdown(JsonNode? n)
    {
        var text=n.S("text");
        if(n?["marks"] is JsonArray marks)foreach(var m in marks)
        {
            text=m.S("type") switch {"bold"=>"**"+text+"**","italic"=>"*"+text+"*","underline"=>"<u>"+text+"</u>","strike"=>"~~"+text+"~~","code"=>"`"+text+"`","link"=>"["+text+"]("+m?["attrs"].S("href")+")",_=>text};
            if(m.S("type")=="textStyle"&&m?["attrs"].S("color") is {Length:>0} c)text="{"+c+":"+text+"}";
        }
        var children=n?["content"] is JsonArray a?string.Concat(a.Select(NodeMarkdown)):text;
        return n.S("type") switch {"paragraph"=>children+"\n","heading"=>new string('#',(int)(n?["attrs"].N("level",1)??1))+" "+children+"\n","hardBreak"=>"\n","horizontalRule"=>"---\n","listItem"=>"- "+children,"taskItem"=>"- ["+((n?["attrs"].B("checked")??false)?"x":" ")+"] "+children,"blockquote"=>"> "+children,_=>children};
    }
    public static IBrush Brush(string? color,string fallback="#dddddd")
    {
        var named=new Dictionary<string,string>{{"red","#e57373"},{"orange","#ffb74d"},{"yellow","#ffd54f"},{"green","#81c784"},{"teal","#4db6ac"},{"blue","#64b5f6"},{"purple","#ba68c8"},{"pink","#f06292"},{"grey","#bdbdbd"},{"gray","#bdbdbd"}};
        try{return new SolidColorBrush(Color.Parse(color!=null&&named.TryGetValue(color.ToLowerInvariant(),out var hex)?hex:color??fallback));}catch{return new SolidColorBrush(Color.Parse(fallback));}
    }
    private sealed record Mark(string Text,bool Bold=false,bool Italic=false,bool Underline=false,bool Strike=false,bool Code=false,string? Color=null,string? Link=null);
    private static readonly Regex InlinePattern=new(@"(\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|<u>(.+?)</u>|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\{([^:{}]+):([^{}]+)\}|_([^_]+)_)",RegexOptions.Compiled);
    private static IEnumerable<Mark> Parse(string text)
    {
        var offset=0;
        foreach(Match m in InlinePattern.Matches(text))
        {
            if(m.Index>offset)yield return new(text[offset..m.Index]);
            if(m.Groups[2].Success){foreach(var inner in Parse(m.Groups[2].Value))yield return inner with{Bold=true};}
            else if(m.Groups[3].Success){foreach(var inner in Parse(m.Groups[3].Value))yield return inner with{Strike=true};}
            else if(m.Groups[4].Success)yield return new(m.Groups[4].Value,Code:true);
            else if(m.Groups[5].Success){foreach(var inner in Parse(m.Groups[5].Value))yield return inner with{Underline=true};}
            else if(m.Groups[6].Success){foreach(var inner in Parse(m.Groups[6].Value))yield return inner with{Bold=true};}
            else if(m.Groups[7].Success)yield return new(m.Groups[7].Value,Underline:true,Color:"#6bb5ff",Link:m.Groups[8].Value);
            else if(m.Groups[9].Success){foreach(var inner in Parse(m.Groups[10].Value))yield return inner with{Color=m.Groups[9].Value};}
            else if(m.Groups[11].Success){foreach(var inner in Parse(m.Groups[11].Value))yield return inner with{Italic=true};}
            offset=m.Index+m.Length;
        }
        if(offset<text.Length)yield return new(text[offset..]);
    }
    public static TextBlock Inline(string text,double size,string color,bool bold=false)
    {
        var block=new TextBlock{FontFamily=new FontFamily("Segoe UI"),FontSize=Math.Clamp(size,1,500),Foreground=Brush(color),TextWrapping=TextWrapping.Wrap,LineHeight=size*1.25};
        foreach(var mark in Parse(text))
        {
            var run=new Run(mark.Text){Foreground=Brush(mark.Color??color),FontFamily=block.FontFamily,FontSize=block.FontSize,FontWeight=mark.Bold||bold?FontWeight.Bold:FontWeight.Normal,FontStyle=mark.Italic?FontStyle.Italic:FontStyle.Normal};
            if(mark.Code)run.FontFamily=new FontFamily("Consolas");if(mark.Color!=null)run.Foreground=Brush(mark.Color);
            if(mark.Underline||mark.Link!=null)run.TextDecorations=TextDecorations.Underline;
            if(mark.Strike)run.TextDecorations=TextDecorations.Strikethrough;
            block.Inlines!.Add(run);
        }
        return block;
    }
    public static List<(TextBlock Block,double Y)> Layout(string markdown,double width,double fontSize,string color)
    {
        var result=new List<(TextBlock,double)>();double y=0;
        foreach(var raw in markdown.Replace("\r","").Split('\n'))
        {
            var text=raw;double size=fontSize;bool bold=false;
            var heading=Regex.Match(text,@"^(#{1,3})\s+(.*)$");
            if(heading.Success){size=fontSize*(heading.Groups[1].Length switch{1=>1.7,2=>1.4,_=>1.15});text=heading.Groups[2].Value;bold=true;}
            if(Regex.IsMatch(text,@"^[-*_]{3,}$"))text="────────────────────";
            else if(text.StartsWith("- [x] ",StringComparison.OrdinalIgnoreCase))text="☑  "+text[6..];
            else if(text.StartsWith("- [ ] "))text="☐  "+text[6..];
            else if(text.StartsWith("- ")||text.StartsWith("* "))text="•  "+text[2..];
            else if(text.StartsWith("> "))text="│  "+text[2..];
            var block=Inline(text.Length==0?" ":text,size,color,bold);block.Measure(new(Math.Max(1,width),double.PositiveInfinity));block.Arrange(new(0,0,Math.Max(1,width),block.DesiredSize.Height));
            result.Add((block,y));y+=Math.Max(size*1.25,block.DesiredSize.Height)+2;
        }
        return result;
    }
    public static void Draw(DrawingContext context,IEnumerable<(TextBlock Block,double Y)> blocks,Point position,double maxHeight)
    {
        foreach(var(block,y)in blocks){if(y>maxHeight)break;using(context.PushTransform(Matrix.CreateTranslation(position.X,position.Y+y)))block.Render(context);}
    }
}

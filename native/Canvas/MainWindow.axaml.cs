using System.Globalization;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace CanvasNative;

public partial class MainWindow : Window
{
    public Document Document {get;}=new();
    public CanvasView SurfaceControl=>surface;
    public bool HasPendingEdit=>editBefore!=null||inlineEditor!=null||surface.IsInteracting;
    public bool AgentDiskChanged=>Document.FilePath is string path&&fileStamp!=default&&(!File.Exists(path)||File.GetLastWriteTimeUtc(path)!=fileStamp);
    private CanvasView surface=null!;
    private StackPanel properties=null!,tools=null!;
    private Canvas editorLayer=null!;
    private TextBlock indicator=null!;
    private NativeSettings settings=new();
    private ControlServer? server;
    private string panelKey="\0";
    private string? editBefore;
    private TextBox? inlineEditor;
    private DispatcherTimer timer=new(){Interval=TimeSpan.FromSeconds(2)};
    private DateTime fileStamp;
    private DateTime dismissedExternalStamp;
    private bool closingApproved,checkingFile;
    private JsonObject? propertyClipboard;
    private readonly Dictionary<string,Button> toolButtons=[];
    private static readonly FilePickerFileType Documents=new("Canvas documents"){Patterns=["*.cvdoc","*.json"]};
    public MainWindow()
    {
        AvaloniaXamlLoader.Load(this);surface=this.FindControl<CanvasView>("Surface")!;properties=this.FindControl<StackPanel>("Properties")!;tools=this.FindControl<StackPanel>("Tools")!;editorLayer=this.FindControl<Canvas>("EditorLayer")!;indicator=this.FindControl<TextBlock>("SaveIndicator")!;
        if(Program.Arguments.Contains("--background")){ShowActivated=false;ShowInTaskbar=false;Opacity=0;}
        settings=NativeSettings.Load();surface.Document=Document;surface.Snap=settings.Snap;Width=settings.Width;Height=settings.Height;
        this.FindControl<Grid>("Workspace")!.ColumnDefinitions[3].Width=new GridLength(settings.PanelWidth);
        BuildMenus();BuildTools();ApplyTheme();
        var settingsButton=this.FindControl<Button>("SettingsButton")!;settingsButton.Content=Icon("settings");settingsButton.Click+=async(_,_)=>await ShowSettings();
        Document.Changed+=OnDocumentChanged;surface.EditRequested+=BeginInline;surface.CanvasRequested+=EnterCanvas;surface.ContextRequested+=ContextMenuAt;surface.InteractionFinished+=()=>{panelKey="\0";RefreshPanel();};
        AddHandler(KeyDownEvent,Keys,RoutingStrategies.Tunnel);AddHandler(KeyUpEvent,(_,e)=>{if(e.Key==Key.Space)surface.SpaceDown=false;},RoutingStrategies.Tunnel);
        DragDrop.SetAllowDrop(surface,true);surface.AddHandler(DragDrop.DragOverEvent,DragOver);surface.AddHandler(DragDrop.DropEvent,Drop);
        Activated+=async(_,_)=>await CheckExternalChange();
        Closing+=async(_,e)=>{if(closingApproved)return;e.Cancel=true;FlushEdits();if(!await GuardUnsaved())return;closingApproved=true;Close();};
        Closed+=(_,_)=>{timer.Stop();server?.Dispose();surface.ClearCaches();if(!Program.Arguments.Contains("--test-mode")){settings.Width=Width;settings.Height=Height;settings.PanelWidth=this.FindControl<Grid>("Workspace")!.ColumnDefinitions[3].ActualWidth;settings.Save();}};
        timer.Tick+=async(_,_)=>await AutoSave();
        Opened+=async(_,_)=>{
            var file=Program.Arguments.FirstOrDefault(a=>!a.StartsWith('-')&&(a.EndsWith(".cvdoc",StringComparison.OrdinalIgnoreCase)||a.EndsWith(".json",StringComparison.OrdinalIgnoreCase)));
            if(file!=null)await Safe(()=>OpenPath(file));
            else if(!Program.Arguments.Contains("--test-mode")&&File.Exists(NativeSettings.RecoveryPath))
            {if(await Ask("Recover canvas?","An unsaved native session is available.","Recover","Discard")=="Recover")await Safe(()=>Document.Replace(JsonNode.Parse(File.ReadAllText(NativeSettings.RecoveryPath)).Obj(),false));else File.Delete(NativeSettings.RecoveryPath);}
            server=new ControlServer(this);try{server.Start();}catch(Exception error){await Message("CLI unavailable",error.Message);}
            timer.Start();OnDocumentChanged();if(Program.Arguments.Contains("--background")){if(!Program.Arguments.Contains("--render-test-mode"))Hide();}else surface.Focus();
        };
        OnDocumentChanged();
    }
    private void OnDocumentChanged()
    {
        Title=(Document.Dirty?"• ":"")+(Document.FilePath==null?"Untitled":Path.GetFileName(Document.FilePath))+" — Canvas Native";
        indicator.Text=Document.Dirty?"Unsaved changes":Document.FilePath==null?"":"Saved";
        surface.InvalidateVisual();panelKey="\0";RefreshPanel();RefreshCanvasNavigation();server?.Publish();
    }
    public void EnterCanvas(Entity card)
    {
        FlushEdits();surface.CancelInteraction();Document.EnterCanvas(card.Id);SetTool("cursor");surface.ClearCaches();surface.Focus();
    }
    public void NavigateCanvas(int depth)
    {
        FlushEdits();surface.CancelInteraction();Document.NavigateCanvas(depth);SetTool("cursor");surface.ClearCaches();surface.Focus();
    }
    private void RefreshCanvasNavigation()
    {
        var trail=this.FindControl<StackPanel>("CanvasBreadcrumbs")!;trail.Children.Clear();
        var foreground=RichText.Brush(settings.Theme=="light"?"#333333":"#dddddd");
        var back=new Button{Content="←",Background=Brushes.Transparent,Foreground=foreground,BorderThickness=new(0),Opacity=Document.CanvasPath.Count>0?1:.4};ToolTip.SetTip(back,"Parent canvas (Alt+Left)");back.Click+=(_,_)=>NavigateCanvas(Document.CanvasPath.Count-1);trail.Children.Add(back);
        var titles=new[]{"Main canvas"}.Concat(Document.CanvasTitles).ToArray();
        for(var i=0;i<titles.Length;i++)
        {
            if(i>0)trail.Children.Add(new TextBlock{Text="/",VerticalAlignment=Avalonia.Layout.VerticalAlignment.Center,Opacity=.45});
            var depth=i;var title=string.IsNullOrWhiteSpace(titles[i])?"Untitled canvas":titles[i];
            if(i==titles.Length-1){trail.Children.Add(new TextBlock{Text=title,MaxWidth=200,TextTrimming=TextTrimming.CharacterEllipsis,Foreground=foreground,FontWeight=FontWeight.SemiBold,VerticalAlignment=Avalonia.Layout.VerticalAlignment.Center,Margin=new(6,0)});continue;}
            var crumb=new Button{Content=title,MaxWidth=200,Background=Brushes.Transparent,Foreground=foreground,BorderThickness=new(0)};crumb.Click+=(_,_)=>NavigateCanvas(depth);trail.Children.Add(crumb);
        }
    }
    private void BuildMenus()
    {
        var menu=this.FindControl<Menu>("MainMenu")!;
        MenuItem Item(string title,Action action,string? gesture=null){var item=new MenuItem{Header=title};if(gesture!=null)item.InputGesture=KeyGesture.Parse(gesture);item.Click+=(_,_)=>action();return item;}
        MenuItem Group(string title,params object[] items)=>new(){Header=title,ItemsSource=items};
        menu.ItemsSource=new[]{
            Group("File",Item("New",async()=>{FlushEdits();if(await GuardUnsaved()){Document.New();surface.ClearCaches();}},"Ctrl+N"),Item("Open",async()=>await PickOpen(),"Ctrl+O"),Item("Save",async()=>await Save(),"Ctrl+S"),Item("Save As…",async()=>await Save(true),"Ctrl+Shift+S"),new Separator(),Item("Import JSON…",async()=>await PickOpen()),Item("Export JSON…",async()=>await ExportJson()),Item("Export PNG…",async()=>await ExportPng())),
            Group("Edit",Item("Undo",()=>{FlushEdits();Document.Undo();},"Ctrl+Z"),Item("Redo",()=>{FlushEdits();Document.Redo();},"Ctrl+Shift+Z"),new Separator(),Item("Cut",async()=>{await Copy();Document.DeleteSelection();},"Ctrl+X"),Item("Copy",async()=>await Copy(),"Ctrl+C"),Item("Paste",async()=>await Paste(),"Ctrl+V"),Item("Duplicate",()=>Duplicate(),"Ctrl+D"),Item("Delete",()=>Document.DeleteSelection(),"Delete"),Item("Select All",()=>Document.Select(Document.Entities.Select(e=>e.Id).ToArray()),"Ctrl+A")),
            Group("View",Item("Focus selection / all",()=>surface.FocusContent(),"F"),Item("Reset Zoom",()=>{surface.Zoom(1/surface.Scale,new(surface.Bounds.Width/2,surface.Bounds.Height/2));}),Item("Zoom In",()=>surface.Zoom(1.1,new(surface.Bounds.Width/2,surface.Bounds.Height/2))),Item("Zoom Out",()=>surface.Zoom(1/1.1,new(surface.Bounds.Width/2,surface.Bounds.Height/2))),Item("Snap to grid",()=>{settings.Snap=surface.Snap=!surface.Snap;settings.Save();})),
            Group("Add",Item("Add Node",()=>AddAt("text",surface.Center)),Item("Add Sub-canvas",()=>AddAt("subCanvas",surface.Center)),Item("Add Arrow",()=>AddAt("arrow",surface.Center)),new Separator(),Item("Add Rectangle",()=>AddAt("rectangle",surface.Center)),Item("Add Circle",()=>AddAt("circle",surface.Center)),Item("Add Triangle",()=>AddAt("triangle",surface.Center)),Item("Add Diamond",()=>AddAt("diamond",surface.Center)),new Separator(),Item("Add Connector",()=>AddAt("connector",surface.Center)),Item("Add Image Container",()=>AddAt("image",surface.Center)))
        };
    }
    private new Control Icon(string name)
    {
        var paths=new Dictionary<string,string>{["subCanvas"]="M3 3 L21 3 L21 21 L3 21 Z M7 8 L17 8 M7 12 L13 12 M13 16 L18 16 M16 14 L18 16 L16 18",["cursor"]="M3 3 L10 20 L13 13 L20 10 Z M13 13 L20 20",["arrow"]="M5 19 L19 5 M12 5 L19 5 L19 12",["connector"]="M4 20 L20 4 M3 19 L5 21 M19 3 L21 5",["text"]="M4 7 L4 4 L20 4 L20 7 M12 4 L12 20 M8 20 L16 20",["image"]="M3 3 L21 3 L21 21 L3 21 Z M7 7 L17 7 L17 17 L7 17 Z M8 15 L11 12 L15 16",["rectangle"]="M3 3 L21 3 L21 21 L3 21 Z",["circle"]="M12 3 A9 9 0 1 1 11.99 3 Z",["triangle"]="M12 2 L22 22 L2 22 Z",["diamond"]="M12 2 L22 12 L12 22 L2 12 Z",["settings"]="M9 3 L15 3 L16 6 L19 7 L22 10 L20 13 L20 17 L17 20 L13 20 L10 22 L7 19 L6 16 L3 15 L3 9 L6 8 L7 5 Z M15 12 A3 3 0 1 1 9 12 A3 3 0 1 1 15 12"};
        return new Avalonia.Controls.Shapes.Path{Data=Geometry.Parse(paths.GetValueOrDefault(name,paths["rectangle"])),Stroke=RichText.Brush(name=="cursor"?"#6bb5ff":"#999"),StrokeThickness=1.5,Width=20,Height=20,Stretch=Stretch.Uniform};
    }
    private void BuildTools()
    {
        foreach(var(tool,label)in new[]{("cursor","Cursor (V)"),("arrow","Arrow (A)"),("connector","Connection Line (L)"),("text","Text Box (T)"),("subCanvas","Sub-canvas (B)"),("image","Image Container (I)"),("rectangle","Shapes (R)")})
        {
            var button=new Button{Content=Icon(tool)};button.Classes.Add("tool");ToolTip.SetTip(button,label);button.Click+=(_,_)=>SetTool(tool);tools.Children.Add(button);toolButtons[tool]=button;
            if(tool=="rectangle")
            {
                var context=new ContextMenu();context.ItemsSource=new[]{"rectangle","circle","triangle","diamond"}.Select(shape=>{var item=new MenuItem{Header=char.ToUpper(shape[0])+shape[1..],Icon=Icon(shape)};item.Click+=(_,_)=>SetTool(shape);return item;}).ToArray();button.ContextMenu=context;
                button.Click+=(_,_)=>context.Open(button);
            }
        }
        SetTool("cursor");
    }
    public void SetTool(string tool)
    {
        FlushEdits();surface.Tool=tool;foreach(var pair in toolButtons){pair.Value.Classes.Set("active",pair.Key==tool||(pair.Key=="rectangle"&&new[]{"circle","triangle","diamond"}.Contains(tool)));if(pair.Key=="rectangle")pair.Value.Content=Icon(new[]{"rectangle","circle","triangle","diamond"}.Contains(tool)?tool:"rectangle");}surface.Focus();
    }
    public Entity AddAt(string tool,Point center)
    {
        FlushEdits();if(tool=="subCanvas"){Entity? card=null;Document.Edit(()=>{card=Document.CreateSubCanvas(center-new Vector(140,90));Document.Selection.Clear();Document.Selection.Add(card.Id);});return card!;}Entity? created=null;Document.Edit(()=>{var type=tool is "arrow" or "connector"?tool:tool=="text"?"textBox":"shape";var size=tool=="text"?new Size(240,160):tool=="image"?new Size(280,220):new Size(120,80);created=Document.Create(type,type is "arrow" or "connector"?center-new Vector(60,0):center-new Vector(size.Width/2,size.Height/2),size,tool is "text" or "image" or "arrow" or "connector"?"rectangle":tool);Document.Selection.Clear();Document.Selection.Add(created.Id);});return created!;
    }
    private void Heading(string title)=>properties.Children.Add(new TextBlock{Text=title,FontWeight=FontWeight.SemiBold,Margin=new(0,8,0,2)});
    private void Row(string label,Control field){var row=new StackPanel{Spacing=2};row.Children.Add(new TextBlock{Text=label});row.Children.Add(field);properties.Children.Add(row);}
    private Button Button(string title,Action action){var button=new Button{Content=title,HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Stretch};button.Click+=(_,_)=>action();return button;}
    private IEnumerable<Entity> Selected()=>Document.Selection.Select(Document.Find).OfType<Entity>();
    private void BeginPanelEdit(){if(editBefore==null)editBefore=Document.Snapshot();}
    public void FlushEdits()
    {
        EndInline(true);if(editBefore is not string snapshot)return;editBefore=null;Document.Commit(snapshot);
    }
    private void TextField(string label,string field,string value,bool multiline=false)
    {
        var ids=Document.Selection.ToArray();var input=new TextBox{Text=value,AcceptsReturn=multiline,TextWrapping=multiline?TextWrapping.Wrap:TextWrapping.NoWrap,MinHeight=multiline?120:28,MaxHeight=multiline?400:double.PositiveInfinity,Watermark=label};
        input.GotFocus+=(_,_)=>BeginPanelEdit();input.TextChanged+=(_,_)=>{if(!input.IsFocused)return;BeginPanelEdit();foreach(var id in ids){var e=Document.Find(id);if(e==null||e.Locked)continue;e.Data[field]=input.Text??"";if(field=="text"&&e.Type=="textBox"){e.Data.Remove("content");e.Data.Remove("blocks");}}surface.InvalidateVisual();};
        input.LostFocus+=(_,_)=>FlushEdits();input.KeyDown+=(_,e)=>{if(e.Key==Key.Escape){if(editBefore is string snapshot){editBefore=null;Document.Restore(snapshot);panelKey="\0";RefreshPanel();}surface.Focus();e.Handled=true;}else if(e.Key==Key.Enter&&(!multiline||e.KeyModifiers.HasFlag(KeyModifiers.Control))){FlushEdits();surface.Focus();e.Handled=true;}};
        Row(label,input);if(multiline)properties.Children.Insert(properties.Children.Count-1,FormatToolbar(input));
    }
    private Control FormatToolbar(TextBox input)
    {
        var panel=new WrapPanel{Orientation=Avalonia.Layout.Orientation.Horizontal};
        foreach(var(label,start,end)in new[]{("B","**","**"),("I","_","_"),("U","<u>","</u>"),("S","~~","~~"),("H1","# ",""),("H2","## ",""),("H3","### ",""),("•","\n- ",""),("1.","\n1. ",""),("☐","\n- [ ] ",""),("❞","\n> ",""),("</>","`","`"),("—","\n___\n",""),("↗","[","](https://)"),("Color","{blue:","}")})
        {
            var button=new Button{Content=label,MinWidth=26,MinHeight=24,Padding=new(4,2),Focusable=false,Margin=new(0,0,2,2)};
            button.Click+=(_,_)=>{var a=Math.Min(input.SelectionStart,input.SelectionEnd);var b=Math.Max(input.SelectionStart,input.SelectionEnd);var text=input.Text??"";input.Focus();BeginPanelEdit();input.Text=text[..a]+start+(b>a?text[a..b]:"text")+end+text[b..];input.SelectionStart=a+start.Length;input.SelectionEnd=a+start.Length+(b>a?b-a:4);};panel.Children.Add(button);
        }
        return panel;
    }
    private void NumberField(string label,string field,double value,double minimum=-1e7,double maximum=1e7,JsonObject? target=null)
    {
        var ids=Document.Selection.ToArray();var numeric=new NumericUpDown{Value=(decimal)Math.Clamp(value,minimum,maximum),Minimum=(decimal)minimum,Maximum=(decimal)maximum,Increment=1,FormatString="0.##",MinHeight=28,Padding=new(6,3)};
        numeric.GotFocus+=(_,_)=>BeginPanelEdit();numeric.ValueChanged+=(_,_)=>{if(numeric.Value is not decimal v)return;BeginPanelEdit();if(target!=null)target[field]=(double)v;else foreach(var id in ids){var e=Document.Find(id);if(e!=null&&!e.Locked)e.Data[field]=(double)v;}surface.InvalidateVisual();};numeric.LostFocus+=(_,_)=>FlushEdits();
        var labelBlock=new TextBlock{Text=label,Cursor=new Cursor(StandardCursorType.SizeWestEast)};var row=new StackPanel{Spacing=2};row.Children.Add(labelBlock);row.Children.Add(numeric);properties.Children.Add(row);
        Point? drag=null;decimal original=0;
        labelBlock.PointerPressed+=(_,e)=>{if(!e.GetCurrentPoint(labelBlock).Properties.IsLeftButtonPressed)return;BeginPanelEdit();drag=e.GetPosition(this);original=numeric.Value??0;e.Pointer.Capture(labelBlock);};
        labelBlock.PointerMoved+=(_,e)=>{if(drag is Point p)numeric.Value=Math.Clamp(original+(decimal)(e.GetPosition(this).X-p.X),numeric.Minimum,numeric.Maximum);};
        labelBlock.PointerReleased+=(_,e)=>{drag=null;e.Pointer.Capture(null);FlushEdits();};
    }
    private void ColorField(string label,string field,string value)
    {
        var ids=Document.Selection.ToArray();var button=new Button{Background=RichText.Brush(value),Height=24,MinHeight=24,Padding=new(0),BorderThickness=new(1),BorderBrush=RichText.Brush("#2b2b2b"),HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Stretch};ToolTip.SetTip(button,value);
        button.Click+=async(_,_)=>{var color=await PickColor(value);if(color==null)return;Document.Edit(()=>{foreach(var id in ids){var e=Document.Find(id);if(e!=null&&!e.Locked)e.Data[field]=color;}});panelKey="\0";RefreshPanel();};Row(label,button);
    }
    private static IBrush Contrast(string color){var b=RichText.Brush(color) as SolidColorBrush;return b!=null&&b.Color.R*.299+b.Color.G*.587+b.Color.B*.114>150?Brushes.Black:Brushes.White;}
    private void RefreshPanel()
    {
        var selection=Selected().ToList();var key=string.Join(",",selection.Select(e=>e.Id));
        if(key==panelKey&&properties.Children.Count>0)return;panelKey=key;properties.Children.Clear();
        if(selection.Count==0){properties.Children.Add(new TextBlock{Text="No selection",Foreground=RichText.Brush("#999")});return;}
        var e=selection[0];var d=e.Data;var mixed=selection.Select(x=>x.Type).Distinct().Count()>1;
        Heading(selection.Count>1?selection.Count+" objects selected":d["subCanvas"] is JsonObject?"Sub-canvas":e.Type switch{"textBox"=>"Text Box","shape"=>"Shape","connection"=>"Connection","connector"=>"Connector",_=>"Arrow"});
        if(selection.Count==1&&d["subCanvas"] is JsonObject)properties.Children.Add(Button("Open canvas →",()=>EnterCanvas(e)));
        var locked=new CheckBox{Content="Locked",IsChecked=selection.All(x=>x.Locked)};locked.IsCheckedChanged+=(_,_)=>Document.Edit(()=>{foreach(var entity in Selected())entity.Data["locked"]=locked.IsChecked==true;});
        if(!mixed)
        {
            if(e.Type=="textBox")
            {
                TextField("Title","title",d.S("title"));ColorField("Title Color","titleColor",d.S("titleColor","#e7e7e7"));
                ColorField("Color","color",d.S("color","#1a1a1a"));ColorField("Border","borderColor",d.S("borderColor","#444444"));ColorField("Text Color","textColor",d.S("textColor","#dddddd"));NumberField("Font Size","fontSize",d.N("fontSize",14),1,500);
            }
            else if(e.Type=="shape")
            {
                ColorField("Color","color",d.S("color","#2b2b2b"));ColorField("Border","borderColor",d.S("borderColor","#6bb5ff"));NumberField("Border W","borderWidth",d.N("borderWidth",2),0,200);
            }
            else
            {
                ColorField("Color","color",d.S("color","#6bb5ff"));
                if(e.Type=="connection")TextField("Text","text",d.S("text"));
                else {foreach(var f in new[]{"x1","y1","x2","y2"})NumberField(f.ToUpperInvariant(),f,d.N(f));NumberField("Line Width","lineWidth",d.N("lineWidth",2),.1,200);if(e.Type=="arrow")NumberField("Head Size","headSize",d.N("headSize",14),0,200);}
            }
        }
        if(selection.All(x=>x.IsBox))
        {
            NumberField("Width","w",d.N("w",120),e.Type=="textBox"?10:20);NumberField("Height","h",d.N("h",80),e.Type=="textBox"?10:20);
            if(e.Type=="shape"&&d.S("shapeType")=="rectangle")NumberField("Radius","cornerRadius",d.N("cornerRadius",4),0,1000);
            if(selection.Count==1&&d["parentId"]!=null)properties.Children.Add(new TextBlock{Text="Parent: "+d.S("parentType")+" "+d.N("parentId"),Foreground=RichText.Brush("#999")});
        }
        if(e.Type=="textBox"&&!mixed)TextField(d["subCanvas"] is JsonObject?"Description":"Text","text",RichText.Markdown(d),true);
        if(e.Type=="shape"&&selection.Count==1)
        {
            Heading("Image");properties.Children.Add(Button("Add / replace image",async()=>await ChooseImage(e)));
            properties.Children.Add(Button("Add image from URL…",async()=>await ImageUrl(e)));
            if(d["image"] is JsonObject image)
            {
                properties.Children.Add(Button("Remove image",()=>{Document.Edit(()=>d.Remove("image"));panelKey="\0";RefreshPanel();}));
                foreach(var f in new[]{"x","y","w","h"})NumberField("Image "+f.ToUpperInvariant(),f,image.N(f,f is "w" or "h"?100:10),f is "w" or "h"?1:-1e7,1e7,image);
                var ratio=new CheckBox{Content="Keep aspect ratio",IsChecked=image.B("keepRatio")};ratio.IsCheckedChanged+=(_,_)=>Document.Edit(()=>image["keepRatio"]=ratio.IsChecked==true);properties.Children.Add(ratio);
            }
        }
        if(selection.Count==2&&selection.All(x=>x.IsBox))
        {
            Heading("Connect");foreach(var kind in new[]{"arrow","connector","connection"}){if(kind=="connection"&&selection.Any(x=>x.Type!="textBox"))continue;properties.Children.Add(Button("Connect with "+kind,()=>Document.Edit(()=>Document.Connect(selection[0],selection[1],kind))));}
        }
        Heading("Actions");properties.Children.Add(locked);if(selection.Count==1&&e.IsBox){NumberField("X","x",d.N("x"));NumberField("Y","y",d.N("y"));}properties.Children.Add(Button("Copy properties",()=>propertyClipboard=d.Clone()));properties.Children.Add(Button("Paste properties",()=>{if(propertyClipboard==null)return;Document.Edit(()=>{foreach(var entity in Selected().Where(x=>!x.Locked))foreach(var f in new[]{"color","borderColor","borderWidth","cornerRadius","textColor","titleColor","fontSize","lineWidth","headSize"})if(propertyClipboard[f]!=null)entity.Data[f]=propertyClipboard[f]!.DeepClone();});panelKey="\0";RefreshPanel();}));
        properties.Children.Add(Button("Duplicate",Duplicate));properties.Children.Add(Button("Delete",()=>Document.DeleteSelection()));
    }
    private void BeginInline(Entity e,string field)
    {
        if(e.Locked)return;if(e.Type=="shape"){_ = ChooseImage(e);return;}if(e.Type is not("textBox" or "connection"))return;
        FlushEdits();Document.Select(e.Id);var r=e.IsBox?e.Bounds:new Rect(GeometryMath.Endpoints(Document,e).B,new Size(200,60));var p=surface.Screen(r.Position);var width=Math.Clamp(r.Width*surface.Scale,120,Math.Max(120,surface.Bounds.Width));var height=field=="title"?32:Math.Clamp(r.Height*surface.Scale,80,500);
        inlineEditor=new TextBox{Text=field=="text"&&e.Type=="textBox"?RichText.Markdown(e.Data):e.Data.S(field),Width=width,Height=height,AcceptsReturn=field!="title",TextWrapping=TextWrapping.Wrap,FontSize=Math.Clamp(e.Data.N("fontSize",14)*surface.Scale,10,40),Background=RichText.Brush(e.Data.S("color","#1a1a1a")),BorderBrush=RichText.Brush("#6bb5ff")};
        Canvas.SetLeft(inlineEditor,Math.Clamp(p.X,0,Math.Max(0,surface.Bounds.Width-width)));Canvas.SetTop(inlineEditor,Math.Clamp(p.Y,0,Math.Max(0,surface.Bounds.Height-height)));editorLayer.IsHitTestVisible=true;editorLayer.Children.Add(inlineEditor);var box=inlineEditor;var snapshot=Document.Snapshot();
        box.TextChanged+=(_,_)=>{e.Data[field]=box.Text??"";if(field=="text"&&e.Type=="textBox"){e.Data.Remove("content");e.Data.Remove("blocks");}surface.InvalidateVisual();};
        box.KeyDown+=(_,args)=>{if(args.Key==Key.Escape){EndInline(false);Document.Restore(snapshot);args.Handled=true;}else if(args.Key==Key.Enter&&(field=="title"||args.KeyModifiers.HasFlag(KeyModifiers.Control))){EndInline(true);args.Handled=true;}};
        box.LostFocus+=(_,_)=>EndInline(true);inlineSnapshot=snapshot;Dispatcher.UIThread.Post(()=>{box.Focus();box.SelectAll();});
    }
    private string? inlineSnapshot;
    private void EndInline(bool commit)
    {
        if(inlineEditor==null)return;var snapshot=inlineSnapshot;inlineEditor=null;inlineSnapshot=null;editorLayer.Children.Clear();editorLayer.IsHitTestVisible=false;if(commit&&snapshot!=null)Document.Commit(snapshot);panelKey="\0";RefreshPanel();
    }
    private void ContextMenuAt(Point position)
    {
        var world=surface.World(position);var hit=surface.Hit(world);if(hit!=null&&!Document.Selection.Contains(hit.Id))Document.Select(hit.Id);
        MenuItem Item(string label,Action action){var item=new MenuItem{Header=label};item.Click+=(_,_)=>action();return item;}
        var add=new MenuItem{Header="Add",ItemsSource=new[]{"text","subCanvas","arrow","connector","rectangle","circle","triangle","diamond","image"}.Select(t=>Item(t,()=>AddAt(t,world))).ToArray()};
        var items=new List<object>{add,new Separator(),Item("Copy",async()=>await Copy()),Item("Paste here",async()=>await Paste(world)),Item("Duplicate",Duplicate),Item("Delete",()=>Document.DeleteSelection()),Item("Focus",()=>surface.FocusContent())};
        if(hit?.Data["subCanvas"] is JsonObject)items.Insert(0,Item("Open canvas →",()=>EnterCanvas(hit)));
        if(hit is {IsBox:true})items.Add(new MenuItem{Header="Connect to…",ItemsSource=Document.Entities.Where(x=>x.IsBox&&x.Id!=hit.Id).Select(target=>Item(target.Data.S("title",target.Id),()=>Document.Edit(()=>Document.Connect(hit,target,hit.Type=="textBox"&&target.Type=="textBox"?"connection":"arrow")))).ToArray()});
        surface.ContextMenu=new ContextMenu{ItemsSource=items};surface.ContextMenu.Open(surface);
    }
    public async Task Copy(){FlushEdits();if(Clipboard!=null)await Clipboard.SetTextAsync(Document.CopySelection().ToJsonString());}
    public async Task Paste(Point? at=null)
    {
        FlushEdits();if(Clipboard==null)return;var text=await Clipboard.GetTextAsync();if(string.IsNullOrEmpty(text))return;
        try{if(JsonNode.Parse(text) is JsonObject p&&p["meta"].S("format")=="canvaswebtool-portable"){var delta=new Vector(20,20);if(at is Point point){var temp=new Document();temp.Load(p);var boxes=temp.Entities.Where(x=>x.IsBox).ToList();if(boxes.Count>0){var bounds=boxes.Select(x=>x.Bounds).Aggregate((a,b)=>a.Union(b));delta=point-bounds.Center;}}Document.Paste(p,delta);return;}}catch(System.Text.Json.JsonException){}
        var e=AddAt("text",at??surface.Center);Document.Edit(()=>e.Data["text"]=text);panelKey="\0";RefreshPanel();
    }
    public void Duplicate(){FlushEdits();Document.Paste(Document.CopySelection(),new(20,20));}
    private void Keys(object? sender,KeyEventArgs e)
    {
        var input=e.Source as Control;var editing=input is TextBox||input?.GetVisualAncestors().Any(c=>c is TextBox or NumericUpDown)==true;
        var control=e.KeyModifiers.HasFlag(KeyModifiers.Control);var shift=e.KeyModifiers.HasFlag(KeyModifiers.Shift);
        if(control&&e.Key==Key.S){e.Handled=true;FlushEdits();_ = Save(shift);return;}
        if(control&&e.Key==Key.O){e.Handled=true;_ = PickOpen();return;}
        if(control&&e.Key==Key.N){e.Handled=true;_ = NewWithGuard();return;}
        if(editing)return;
        if(e.Key==Key.Left&&e.KeyModifiers.HasFlag(KeyModifiers.Alt)){NavigateCanvas(Document.CanvasPath.Count-1);e.Handled=true;return;}
        if(e.Key==Key.Enter&&Document.Selection.Count==1&&Selected().FirstOrDefault()?.Data["subCanvas"] is JsonObject){EnterCanvas(Selected().First());e.Handled=true;return;}
        if(e.Key==Key.Space){surface.SpaceDown=true;e.Handled=true;return;}
        if(e.Key==Key.Escape){surface.CancelInteraction();Document.Select();SetTool("cursor");e.Handled=true;return;}
        if(control)
        {
            switch(e.Key)
            {
                case Key.Z:FlushEdits();if(shift)Document.Redo();else Document.Undo();break;
                case Key.Y:FlushEdits();Document.Redo();break;
                case Key.A:Document.Select(Document.Entities.Select(x=>x.Id).ToArray());break;
                case Key.C:_ = Copy();break;
                case Key.X:_ = Cut();break;
                case Key.V:_ = Paste();break;
                case Key.D:Duplicate();break;
                default:return;
            }
            panelKey="\0";RefreshPanel();e.Handled=true;return;
        }
        if(e.Key is Key.Delete or Key.Back){FlushEdits();Document.DeleteSelection();e.Handled=true;}
        else if(e.Key is Key.Left or Key.Right or Key.Up or Key.Down)
        {
            var amount=shift?10:1;var delta=e.Key switch{Key.Left=>new Vector(-amount,0),Key.Right=>new Vector(amount,0),Key.Up=>new Vector(0,-amount),_=>new Vector(0,amount)};Document.Edit(()=>{foreach(var entity in Document.MovingSelection().Where(x=>x.Type!="connection"))Document.Move(entity,delta);});e.Handled=true;
        }
        else if(e.Key==Key.F){surface.FocusContent();e.Handled=true;}
        else if(e.Key switch{Key.V=>"cursor",Key.A=>"arrow",Key.L=>"connector",Key.T=>"text",Key.B=>"subCanvas",Key.I=>"image",Key.R=>"rectangle",Key.C=>"circle",Key.D=>"diamond",_=>null} is string tool){SetTool(tool);e.Handled=true;}
    }
    private async Task Cut(){await Copy();Document.DeleteSelection();}
    private async Task NewWithGuard(){FlushEdits();if(await GuardUnsaved())Document.New();}
    private async Task PickOpen()
    {
        FlushEdits();if(!await GuardUnsaved())return;var files=await StorageProvider.OpenFilePickerAsync(new(){Title="Open Canvas document",FileTypeFilter=[Documents]});if(files.Count>0&&files[0].TryGetLocalPath() is string path)await Safe(()=>OpenPath(path));
    }
    public void OpenPath(string path){FlushEdits();Document.Open(path);fileStamp=File.GetLastWriteTimeUtc(path);surface.ClearCaches();panelKey="\0";RefreshPanel();}
    public async Task<bool> Save(bool saveAs=false)
    {
        FlushEdits();var path=saveAs?null:Document.FilePath;
        if(path==null){var file=await StorageProvider.SaveFilePickerAsync(new(){Title="Save Canvas document",DefaultExtension="cvdoc",SuggestedFileName=Document.FilePath==null?"Untitled.cvdoc":Path.GetFileName(Document.FilePath),FileTypeChoices=[Documents],ShowOverwritePrompt=true});path=file?.TryGetLocalPath();if(path==null)return false;}
        if(!saveAs&&Document.FilePath==path&&File.Exists(path)&&File.GetLastWriteTimeUtc(path)!=fileStamp){if(await Ask("File changed on disk","Overwrite the external changes with your current canvas?","Overwrite","Cancel")!="Overwrite")return false;}
        try{SavePath(path);return true;}catch(Exception error){await Message("Could not save",error.Message);return false;}
    }
    public void SavePath(string path){FlushEdits();Document.Save(path);fileStamp=File.GetLastWriteTimeUtc(path);dismissedExternalStamp=default;if(!Program.Arguments.Contains("--test-mode")&&File.Exists(NativeSettings.RecoveryPath))File.Delete(NativeSettings.RecoveryPath);}
    public async Task<bool> GuardUnsaved()
    {
        if(!Document.Dirty)return true;var result=await Ask("Unsaved changes","Save your changes before continuing?","Save","Discard","Cancel");return result=="Discard"||(result=="Save"&&await Save());
    }
    public async Task Safe(Action action){try{action();}catch(Exception error){await Message("Canvas",error.Message);}}
    private async Task ExportJson()
    {
        FlushEdits();var file=await StorageProvider.SaveFilePickerAsync(new(){Title="Export portable JSON",DefaultExtension="json",SuggestedFileName="Canvas.json",FileTypeChoices=[new("JSON"){Patterns=["*.json"]}],ShowOverwritePrompt=true});if(file?.TryGetLocalPath() is string path)await Safe(()=>{var entire=new Document();entire.Load(Document.Root);File.WriteAllText(path,Portable.Export(entire).ToJsonString(Json.Options));});
    }
    public void Capture(string path,bool canvasOnly=false)
    {
        this.UpdateLayout();
        var visual=canvasOnly?(Control)surface:this.FindControl<Grid>("Root")!;var size=visual.Bounds.Size;using var bitmap=new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(size.Width),(int)Math.Ceiling(size.Height)),new Vector(96,96));bitmap.Render(visual);Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);bitmap.Save(path);
    }
    private async Task ExportPng(){var file=await StorageProvider.SaveFilePickerAsync(new(){Title="Export canvas PNG",DefaultExtension="png",SuggestedFileName="Canvas.png",FileTypeChoices=[new("PNG"){Patterns=["*.png"]}],ShowOverwritePrompt=true});if(file?.TryGetLocalPath() is string path)await Safe(()=>Capture(path,true));}
    private async Task ChooseImage(Entity e)
    {
        if(e.Locked)return;var files=await StorageProvider.OpenFilePickerAsync(new(){Title="Choose image",FileTypeFilter=[FilePickerFileTypes.ImageAll]});if(files.Count>0&&files[0].TryGetLocalPath() is string path)await Safe(()=>SetImage(e,Document.DataUri(path),Path.GetFileName(path)));
    }
    public void SetImage(Entity e,string uri,string name)
    {
        if(e.Type!="shape"||e.Locked)return;using var bitmap=new Bitmap(new MemoryStream(Convert.FromBase64String(uri[(uri.IndexOf(',')+1)..])));var size=bitmap.Size;var ratio=Math.Min(Math.Max(1,e.Bounds.Width-20)/size.Width,Math.Max(1,e.Bounds.Height-20)/size.Height);var w=size.Width*ratio;var h=size.Height*ratio;
        Document.Edit(()=>e.Data["image"]=new JsonObject{["id"]=1,["src"]=uri,["fileName"]=name,["x"]=(e.Bounds.Width-w)/2,["y"]=(e.Bounds.Height-h)/2,["w"]=w,["h"]=h,["keepRatio"]=true});panelKey="\0";RefreshPanel();
    }
    private async Task ImageUrl(Entity e)
    {
        if(e.Locked)return;var input=new TextBox{Watermark="https://…",MinWidth=380};var dialog=Dialog("Image URL",input);var buttons=new StackPanel{Orientation=Avalonia.Layout.Orientation.Horizontal,Spacing=8,HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Right};buttons.Children.Add(Button("Cancel",()=>dialog.Close(false)));buttons.Children.Add(Button("Load",()=>dialog.Close(true)));((StackPanel)dialog.Content!).Children.Add(buttons);
        if(!await dialog.ShowDialog<bool>(this))return;
        try{using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(20)};using var response=await client.GetAsync(input.Text,HttpCompletionOption.ResponseHeadersRead);response.EnsureSuccessStatusCode();if(response.Content.Headers.ContentLength>32*1024*1024)throw new InvalidDataException("Image exceeds 32 MB.");var mime=response.Content.Headers.ContentType?.MediaType??"image/png";if(!mime.StartsWith("image/"))throw new InvalidDataException("URL does not return an image.");await using var stream=await response.Content.ReadAsStreamAsync();using var bytes=new MemoryStream();var buffer=new byte[8192];int read;while((read=await stream.ReadAsync(buffer))>0){if(bytes.Length+read>32*1024*1024)throw new InvalidDataException("Image exceeds 32 MB.");bytes.Write(buffer,0,read);}SetImage(e,$"data:{mime};base64,{Convert.ToBase64String(bytes.ToArray())}",Path.GetFileName(new Uri(input.Text!).AbsolutePath));}catch(Exception error){await Message("Could not load image",error.Message);}
    }
    private void DragOver(object? sender,DragEventArgs e){e.DragEffects=e.Data.Contains(DataFormats.Files)?DragDropEffects.Copy:DragDropEffects.None;e.Handled=true;}
    private async void Drop(object? sender,DragEventArgs e)
    {
        var files=e.Data.GetFiles();if(files==null)return;var point=surface.World(e.GetPosition(surface));
        foreach(var file in files){var path=file.TryGetLocalPath();if(path==null)continue;if(Path.GetExtension(path) is ".cvdoc" or ".json"){if(await GuardUnsaved())await Safe(()=>OpenPath(path));}else await Safe(()=>{var hit=surface.Hit(point,true);var shape=hit?.Type=="shape"?hit:AddAt("image",point);SetImage(shape,Document.DataUri(path),Path.GetFileName(path));});}e.Handled=true;
    }
    private async Task CheckExternalChange()
    {
        if(checkingFile||Document.FilePath==null||fileStamp==default||!File.Exists(Document.FilePath))return;var stamp=File.GetLastWriteTimeUtc(Document.FilePath);if(stamp==fileStamp||stamp==dismissedExternalStamp)return;checkingFile=true;
        try{var choice=await Ask("File changed on disk",Document.Dirty?"The file changed outside Canvas. Reloading will replace your unsaved changes.":"The open file changed outside Canvas.","Reload","Keep current");if(choice=="Reload")await Safe(()=>OpenPath(Document.FilePath));else dismissedExternalStamp=stamp;}finally{checkingFile=false;}
    }
    private async Task AutoSave()
    {
        if(Program.Arguments.Contains("--test-mode")||!Document.Dirty||editBefore!=null||inlineEditor!=null||checkingFile)return;
        try
        {
            if(settings.AutoSave&&Document.FilePath is string path&&(!File.Exists(path)||File.GetLastWriteTimeUtc(path)==fileStamp))SavePath(path);
            else {Directory.CreateDirectory(NativeSettings.DirectoryPath);var recovery=NativeSettings.RecoveryPath+".tmp";File.WriteAllText(recovery,Document.Root.ToJsonString());File.Move(recovery,NativeSettings.RecoveryPath,true);}
        }
        catch(Exception error){indicator.Text="Save failed";timer.Stop();await Message("Auto-save stopped",error.Message+"\nPlease use File > Save As to preserve this canvas.");}
    }
    private Window Dialog(string title,Control body)=>new(){Title=title,SizeToContent=SizeToContent.WidthAndHeight,MinWidth=360,MaxWidth=720,CanResize=false,WindowStartupLocation=WindowStartupLocation.CenterOwner,Content=new StackPanel{Margin=new(20),Spacing=16,Children={body}}};
    public async Task<string> Ask(string title,string message,params string[] choices)
    {
        var dialog=Dialog(title,new TextBlock{Text=message,TextWrapping=TextWrapping.Wrap,MaxWidth=540});var buttons=new StackPanel{Orientation=Avalonia.Layout.Orientation.Horizontal,Spacing=8,HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Right};foreach(var choice in choices)buttons.Children.Add(Button(choice,()=>dialog.Close(choice)));((StackPanel)dialog.Content!).Children.Add(buttons);return await dialog.ShowDialog<string>(this)??"Cancel";
    }
    public Task Message(string title,string message)=>Ask(title,message,"OK");
    private async Task<string?> PickColor(string initial)
    {
        var color=(RichText.Brush(initial) as SolidColorBrush)!.Color;var picker=new ColorView{Color=color,IsAlphaEnabled=true,IsColorPaletteVisible=false,Width=400};var dialog=Dialog("Color",picker);var palette=new WrapPanel();
        foreach(var swatch in settings.Palette){var button=new Button{Background=RichText.Brush(swatch),Width=28,Height=24,Margin=new(2)};button.Click+=(_,_)=>picker.Color=((SolidColorBrush)RichText.Brush(swatch)).Color;palette.Children.Add(button);}((StackPanel)dialog.Content!).Children.Add(palette);
        var buttons=new StackPanel{Orientation=Avalonia.Layout.Orientation.Horizontal,Spacing=8};buttons.Children.Add(Button("Cancel",()=>dialog.Close((string?)null)));buttons.Children.Add(Button("Apply",()=>{var c=picker.Color;dialog.Close(c.A==255?$"#{c.R:x2}{c.G:x2}{c.B:x2}":$"#{c.A:x2}{c.R:x2}{c.G:x2}{c.B:x2}");}));((StackPanel)dialog.Content!).Children.Add(buttons);return await dialog.ShowDialog<string?>(this);
    }
    private void ApplyTheme()
    {
        var light=settings.Theme=="light";Application.Current!.RequestedThemeVariant=light?ThemeVariant.Light:ThemeVariant.Dark;
        this.FindControl<Border>("TopBar")!.Background=RichText.Brush(light?"#e8e8e8":"#181818");this.FindControl<Border>("ToolRail")!.Background=RichText.Brush(light?"#e8e8e8":"#181818");this.FindControl<Border>("PropertiesBorder")!.Background=RichText.Brush(light?"#fff":"#161616");surface.BackgroundColor=light?settings.LightBackground:settings.DarkBackground;surface.GridColor=light?settings.LightGrid:settings.DarkGrid;surface.InvalidateVisual();
    }
    public void SetTheme(string theme){if(theme is not("dark" or "light"))throw new ArgumentException("Unknown theme.");settings.Theme=theme;ApplyTheme();}
    private async Task ShowSettings()
    {
        FlushEdits();var content=new StackPanel{Spacing=12,MinWidth=400};var dialog=Dialog("Settings",content);
        var theme=new ComboBox{ItemsSource=new[]{"dark","light"},SelectedItem=settings.Theme};theme.SelectionChanged+=(_,_)=>{settings.Theme=theme.SelectedItem as string??"dark";ApplyTheme();};content.Children.Add(new TextBlock{Text="Theme"});content.Children.Add(theme);
        content.Children.Add(Button("Canvas background…",async()=>{var c=await PickColor(surface.BackgroundColor);if(c==null)return;if(settings.Theme=="dark")settings.DarkBackground=c;else settings.LightBackground=c;ApplyTheme();}));
        content.Children.Add(Button("Grid line color…",async()=>{var c=await PickColor(surface.GridColor);if(c==null)return;if(settings.Theme=="dark")settings.DarkGrid=c;else settings.LightGrid=c;ApplyTheme();}));
        var snap=new CheckBox{Content="Snap to grid",IsChecked=settings.Snap};snap.IsCheckedChanged+=(_,_)=>settings.Snap=surface.Snap=snap.IsChecked==true;content.Children.Add(snap);
        var auto=new CheckBox{Content="Auto-save named documents",IsChecked=settings.AutoSave};auto.IsCheckedChanged+=(_,_)=>settings.AutoSave=auto.IsChecked==true;content.Children.Add(auto);
        var palette=new TextBox{Text=string.Join(", ",settings.Palette),AcceptsReturn=true,TextWrapping=TextWrapping.Wrap,Height=70};content.Children.Add(new TextBlock{Text="Custom palette (comma-separated hex colors)"});content.Children.Add(palette);
        content.Children.Add(Button("Reset defaults",()=>{settings=new();palette.Text=string.Join(", ",settings.Palette);theme.SelectedItem="dark";auto.IsChecked=settings.AutoSave;snap.IsChecked=false;ApplyTheme();}));
        content.Children.Add(Button("Done",()=>{var colors=(palette.Text??"").Split(',',StringSplitOptions.TrimEntries|StringSplitOptions.RemoveEmptyEntries);try{foreach(var c in colors)Color.Parse(c);settings.Palette=colors;settings.Save();dialog.Close();}catch{palette.Watermark="Use hex colors, e.g. #6bb5ff";}}));await dialog.ShowDialog(this);
    }
}

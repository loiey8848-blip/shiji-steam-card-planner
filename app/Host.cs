using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("拾级 · Steam 配卡助手")]
[assembly: System.Reflection.AssemblyVersion("0.1.11.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.11.0")]

class Planner : Form {
    const string Local = "https://steam-planner.internal";
    readonly WebView2 ui = new WebView2(), steam = new WebView2();
    readonly Panel content = new Panel();
    readonly ProgressBar loadingStrip = new ProgressBar {Dock=DockStyle.Top,Height=4,MarqueeAnimationSpeed=28,Style=ProgressBarStyle.Marquee};
    readonly Panel orderPanel = new Panel();
    readonly DataGridView orderGrid = new DataGridView();
    readonly Button fillOrder = new Button {Dock=DockStyle.Top,Height=34,Text="填入清单数量和价格",Visible=false};
    readonly Button nextBuyOrder = new Button {Dock=DockStyle.Top,Height=34,Text="下一种卡 →",Visible=false};
    readonly Label orderHint = new Label {Dock=DockStyle.Top,Height=72};
    readonly NavTabButton workbench = new NavTabButton(), steamTab = new NavTabButton();
    static readonly Color Backdrop=Color.FromArgb(23,23,25), Chrome=Color.FromArgb(43,38,37),
        TextColor=Color.FromArgb(245,232,218), Selected=Color.FromArgb(99,65,45), Edge=Color.FromArgb(115,87,67);
    string fillPayload,fillUrl,orderSummary;
    bool reconcileOnReturn,singleBuyOrder;
    ulong fillNavigation;
    ulong steamNavigation;
    int activeFills;
    string steamLoadError;
    int? nextBidIndex;
    readonly Label address = new Label();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 48000000, RecursionLimit = 150 };
    readonly HttpClient http = new HttpClient(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate }) { Timeout = TimeSpan.FromSeconds(30) };
    readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SteamCardPlanner");
    bool startupDone;
    bool workbenchReady;
    [DllImport("user32.dll")]
    static extern bool SystemParametersInfo(uint action,uint parameter,[MarshalAs(UnmanagedType.Bool)] out bool value,uint update);
    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        if(!SystemInformation.HighContrast){
            int enabled=1;
            DwmSetWindowAttribute(Handle,20,ref enabled,sizeof(int));
        }
    }
    [STAThread] static void Main() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new Planner());
    }
    Planner() {
        Text = "拾级"; Width = 1320; Height = 880; MinimumSize = new Size(840,600);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9);
        BackColor=Backdrop;
        ui.DefaultBackgroundColor=steam.DefaultBackgroundColor=Backdrop;
        var bar = new Panel {Dock=DockStyle.Top,Height=51,BackColor=Chrome,Padding=new Padding(10,6,14,6)};
        bar.Paint+=(s,e)=>{using(var pen=new Pen(Edge))e.Graphics.DrawLine(pen,0,bar.Height-1,bar.Width,bar.Height-1);};
        var tabs = new FlowLayoutPanel {Dock=DockStyle.Left,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,WrapContents=false,Margin=Padding.Empty};
        foreach (string title in new [] { "配卡工作台", "Steam 官方页面" }) {
            var b = title=="配卡工作台"?workbench:steamTab;
            b.Text=title;b.Width=150;b.Height=37;b.Margin=new Padding(0,0,7,0);
            b.BackColor=Chrome;b.ForeColor=TextColor;
            b.CanAnimate=AnimationsAllowed;
            bool isSteam=title.StartsWith("Steam"); b.Click+=(s,e)=>ShowSteam(isSteam); tabs.Controls.Add(b);
        }
        workbench.Active=true;
        address.ForeColor=Color.FromArgb(201,181,167); address.Dock=DockStyle.Fill;
        address.TextAlign=ContentAlignment.MiddleLeft; address.AutoEllipsis=true; address.Padding=new Padding(9,0,0,0);
        bar.Controls.Add(address);bar.Controls.Add(tabs);
        content.Dock=DockStyle.Fill; Controls.Add(content); Controls.Add(loadingStrip); Controls.Add(bar);
        ui.Dock=steam.Dock=DockStyle.Fill; content.Controls.Add(steam); content.Controls.Add(ui);
        steam.Visible=false;
        orderPanel.Dock=DockStyle.Right; orderPanel.Width=335; orderPanel.Visible=false; orderPanel.Padding=new Padding(10);
        orderPanel.BackColor=Chrome;orderHint.ForeColor=TextColor;
        StyleButton(fillOrder,Selected);
        StyleButton(nextBuyOrder,Chrome);
        orderHint.Text="本批购买清单\n点击单价可复制。";
        orderGrid.Dock=DockStyle.Fill; orderGrid.ReadOnly=true;orderGrid.AllowUserToAddRows=false;orderGrid.AllowUserToDeleteRows=false;orderGrid.RowHeadersVisible=false;orderGrid.AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill;
        orderGrid.Columns.Add("name","卡牌");orderGrid.Columns.Add("qty","数量");orderGrid.Columns.Add("cap","单价上限");
        orderGrid.Columns[0].FillWeight=150;orderGrid.Columns[1].FillWeight=46;orderGrid.Columns[2].FillWeight=76;
        orderGrid.BackgroundColor=Backdrop;orderGrid.BorderStyle=BorderStyle.None;orderGrid.GridColor=Color.FromArgb(69,58,52);
        orderGrid.EnableHeadersVisualStyles=false;
        orderGrid.ColumnHeadersDefaultCellStyle.BackColor=Color.FromArgb(56,45,39);orderGrid.ColumnHeadersDefaultCellStyle.ForeColor=TextColor;
        orderGrid.DefaultCellStyle.BackColor=Backdrop;orderGrid.DefaultCellStyle.ForeColor=TextColor;
        orderGrid.DefaultCellStyle.SelectionBackColor=Selected;orderGrid.DefaultCellStyle.SelectionForeColor=TextColor;
        orderGrid.AlternatingRowsDefaultCellStyle.BackColor=Color.FromArgb(36,32,30);
        orderGrid.RowTemplate.Height=28;orderGrid.ColumnHeadersHeight=30;
        orderGrid.Columns[1].DefaultCellStyle.Alignment=orderGrid.Columns[2].DefaultCellStyle.Alignment=DataGridViewContentAlignment.MiddleRight;
        foreach(DataGridViewColumn col in orderGrid.Columns)col.SortMode=DataGridViewColumnSortMode.NotSortable;
        orderGrid.CellClick+=(s,e)=>{if(e.RowIndex>=0&&e.ColumnIndex==2){try{Clipboard.SetText(Convert.ToString(orderGrid.Rows[e.RowIndex].Tag));}catch(System.Runtime.InteropServices.ExternalException){}}};
        fillOrder.Click+=async(s,e)=>await FillCurrentBuyOrder();
        nextBuyOrder.Click+=(s,e)=>AdvanceBuyQueue();
        orderPanel.Controls.Add(orderGrid);orderPanel.Controls.Add(nextBuyOrder);orderPanel.Controls.Add(fillOrder);orderPanel.Controls.Add(orderHint);content.Controls.Add(orderPanel);
        UpdateLoading();
        Shown+=async(s,e)=>{try { await Init(); } catch(Exception ex){ loadingStrip.Hide(); MessageBox.Show("启动失败。请检查 Microsoft Edge WebView2 运行时及工具目录。\n"+ex.Message,Text); Close(); }};
    }
    static void StyleButton(Button button,Color background) {
        button.FlatStyle=FlatStyle.Flat;
        button.ForeColor=TextColor;
        button.BackColor=background;
        button.FlatAppearance.BorderColor=Edge;
        button.FlatAppearance.MouseOverBackColor=Color.FromArgb(80,56,45);
        button.Cursor=Cursors.Hand;
    }
    async Task Init() {
        var env=await CoreWebView2Environment.CreateAsync(null,data);
        await ui.EnsureCoreWebView2Async(env); await steam.EnsureCoreWebView2Async(env);
        ui.CoreWebView2.SetVirtualHostNameToFolderMapping("steam-planner.internal",Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"app"),CoreWebView2HostResourceAccessKind.DenyCors);
        ui.CoreWebView2.NavigationStarting+=(s,e)=>{if(!e.Uri.StartsWith(Local+"/",StringComparison.Ordinal))e.Cancel=true;};
        ui.CoreWebView2.NavigationCompleted+=(s,e)=>{
            workbenchReady=true;
            UpdateLoading();
            if(!e.IsSuccess&&!steam.Visible)address.Text="配卡工作台加载失败";
        };
        ui.CoreWebView2.WebMessageReceived+=Message;
        ui.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true; Open(e.Uri);};
        steam.CoreWebView2.Settings.IsWebMessageEnabled=false;
        steam.CoreWebView2.NavigationStarting+=(s,e)=>{
            steamNavigation=e.NavigationId;
            steamLoadError=null;
            UpdateLoading();
            if(!singleBuyOrder&&fillPayload!=null&&fillNavigation==0&&e.Uri==fillUrl)fillNavigation=e.NavigationId;
        };
        steam.CoreWebView2.NavigationCompleted+=async(s,e)=>{
            if(steamNavigation==e.NavigationId){
                steamNavigation=0;
                steamLoadError=e.IsSuccess?null:"Steam 页面加载失败";
                UpdateLoading();
            }
            if(fillPayload==null||fillNavigation!=e.NavigationId)return;
            var payload=fillPayload;var target=fillUrl;fillPayload=null;fillNavigation=0;
            if(!e.IsSuccess||steam.CoreWebView2.Source!=target)return;
            activeFills++;
            UpdateLoading();
            try {
                var script=File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"app","steam-form.js"));
                var result=await steam.CoreWebView2.ExecuteScriptAsync(script+"("+payload+")");
                if(steam.CoreWebView2.Source==target)orderHint.Text=orderSummary+"\n"+(json.Deserialize<string>(result)??"请对照清单手动核对。");
            } catch(Exception){
                if(steam.CoreWebView2.Source==target)orderHint.Text=orderSummary+"\n请对照清单手动核对数量和单价。";
            } finally {
                activeFills--;
                if(!IsDisposed)UpdateLoading();
            }
        };
        steam.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true; Open(e.Uri);};
        steam.CoreWebView2.SourceChanged+=(s,e)=>UpdateLoading();
        steam.CoreWebView2.Navigate("https://steamcommunity.com/market/?l=english");
        startupDone=true; ShowSteam(false); ui.CoreWebView2.Navigate(Local+"/index.html?v=18");
    }
    static bool AnimationsAllowed() {
        bool animate;
        return !SystemParametersInfo(0x1042,0,out animate,0)||animate;
    }
    void UpdateLoading() {
        bool loading=steam.Visible?(steamNavigation!=0||activeFills>0):!workbenchReady;
        loadingStrip.Visible=loading&&AnimationsAllowed();
        fillOrder.Enabled=steamNavigation==0&&activeFills==0;
        if(steam.Visible){
            address.Text=steamNavigation!=0?"正在加载 Steam 页面…":activeFills>0?"正在填入 Steam 表单…":
                steamLoadError??(steam.CoreWebView2==null?"Steam 官方页面":steam.CoreWebView2.Source);
        }else address.Text=workbenchReady?string.Empty:"正在打开配卡工作台…";
    }
    void ResetFill() {
        fillPayload=null;fillNavigation=0;singleBuyOrder=false;fillOrder.Visible=false;
        nextBidIndex=null;nextBuyOrder.Visible=false;
    }
    void AdvanceBuyQueue() {
        if(!singleBuyOrder||!nextBidIndex.HasValue)return;
        int index=nextBidIndex.Value;
        ResetFill();
        orderGrid.Rows.Clear();
        reconcileOnReturn=false;
        ShowSteam(false);
        ui.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { @event="nextBuyOrder", index=index }));
    }
    async Task FillCurrentBuyOrder() {
        if(!singleBuyOrder||fillPayload==null||!steam.Visible||steamNavigation!=0||activeFills>0)return;
        var payload=fillPayload;
        var summary=orderSummary;
        var source=steam.CoreWebView2.Source;
        activeFills++;
        fillOrder.Text="正在填入…";
        UpdateLoading();
        try {
            var script=File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"app","steam-form.js"));
            var result=await steam.CoreWebView2.ExecuteScriptAsync(script+"("+payload+")");
            if(!IsDisposed&&fillPayload==payload&&steam.CoreWebView2.Source==source){
                orderHint.Text=summary+"\n"+(json.Deserialize<string>(result)??"请对照右侧清单核对。");
            }
        } catch(Exception) {
            if(!IsDisposed&&fillPayload==payload)orderHint.Text=summary+"\n请对照右侧清单手动输入。";
        } finally {
            activeFills--;
            if(!IsDisposed){fillOrder.Text="填入清单数量和价格";UpdateLoading();}
        }
    }
    void ShowSteam(bool show) {
        if(!startupDone)return;
        bool returned=!show&&reconcileOnReturn;
        if(returned){reconcileOnReturn=false;ResetFill();orderGrid.Rows.Clear();}
        workbench.Text=show&&reconcileOnReturn?"← 返回并核对进度":"配卡工作台";
        workbench.Active=!show;steamTab.Active=show;
        steam.Visible=show; ui.Visible=!show; if(show)steam.BringToFront();else ui.BringToFront();
        orderPanel.Visible=show&&orderGrid.Rows.Count>0;
        if(orderPanel.Visible){orderPanel.SendToBack();content.PerformLayout();}
        UpdateLoading();
        if(returned)ui.CoreWebView2.PostWebMessageAsJson("{\"event\":\"returnedFromOrder\"}");
    }
    void Open(string url) {
        Uri u; if(!Uri.TryCreate(url,UriKind.Absolute,out u)||u.Scheme!="https")return;
        if(u.Host=="steamcommunity.com"||u.Host=="login.steampowered.com"||u.Host=="help.steampowered.com"||u.Host=="store.steampowered.com") { ShowSteam(true);steam.CoreWebView2.Navigate(u.AbsoluteUri); }
        else if(u.Host=="www.steamcardexchange.net")Process.Start(new ProcessStartInfo(u.AbsoluteUri){UseShellExecute=true});
    }
    static string LastSteamId() {
        try {
            var root=Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam","SteamPath","") as string;
            var roots=new List<string>{root??"",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Steam")};
            roots.AddRange(DriveInfo.GetDrives().Where(d=>d.DriveType==DriveType.Fixed).Select(d=>Path.Combine(d.Name,"Steam")));
            string file=roots.Where(r=>r.Length>0).Select(r=>Path.Combine(r,"config","loginusers.vdf")).FirstOrDefault(File.Exists); if(file==null)return "";
            var matches=Regex.Matches(File.ReadAllText(file),@"""(\d{17})""\s*\{([^}]+)\}");
            foreach(Match m in matches)if(Regex.IsMatch(m.Groups[2].Value,@"""MostRecent""\s+""1""",RegexOptions.IgnoreCase))return m.Groups[1].Value;
            if(matches.Count>0)return matches.Cast<Match>().OrderByDescending(m=>{long n;return long.TryParse(Regex.Match(m.Groups[2].Value,@"""timestamp""\s+""(\d+)""",RegexOptions.IgnoreCase).Groups[1].Value,out n)?n:0;}).First().Groups[1].Value;
        } catch(IOException){} catch(UnauthorizedAccessException){} return "";
    }
    static bool Allowed(Uri u) {
        if(u.Scheme!="https"||!u.IsDefaultPort||u.UserInfo.Length>0)return false;
        if(u.Host=="www.steamcardexchange.net")return u.AbsolutePath=="/api/request.php"&&u.Query=="?GetBadgePrices_Guest";
        if(u.Host=="store.steampowered.com")return u.AbsolutePath=="/api/storesearch/"||u.AbsolutePath=="/api/appdetails";
        if(u.Host!="steamcommunity.com")return false;
        return Regex.IsMatch(u.AbsolutePath,@"^/(?:market/(?:orderbook/?|mylistings/?|search/render/?|listings/753/[^/]+/?|$)|inventory/\d{17}/753/6/?|profiles/\d{17}/gamecards/\d+/?|(?:id/[\w-]+|profiles/\d{17})/(?:badges/?)?)$");
    }
    async Task<string> SessionGet(Uri u) {
        Uri page; if(!Uri.TryCreate(steam.CoreWebView2.Source,UriKind.Absolute,out page)||page.Host!="steamcommunity.com")throw new Exception("请在 Steam 官方页面完成登录并打开社区市场，再返回工作台。");
        string quoted=json.Serialize(u.AbsoluteUri);
        string expression="(async()=>{if(location.origin!=='https://steamcommunity.com')throw Error('Steam 页面尚未就绪');const r=await fetch("+quoted+",{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:"+(u.AbsolutePath=="/market/orderbook"?"{'x-valve-request-type':'queryAction'}":"{}")+"});return {status:r.status,text:await r.text()}})()";
        var res=await steam.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate",json.Serialize(new { expression=expression,awaitPromise=true,returnByValue=true }));
        var obj=json.Deserialize<Dictionary<string,object>>(res);
        if(obj.ContainsKey("exceptionDetails"))throw new Exception("Steam 会话请求失败或超时。请打开官方市场确认连接后重试。");
        var value=(Dictionary<string,object>)((Dictionary<string,object>)obj["result"])["value"];
        int code=Convert.ToInt32(value["status"]); if(code<200||code>=300)throw new Exception("Steam HTTP "+code);
        return (string)value["text"];
    }
    async Task<string> Read(string url,bool session) {
        Uri u=new Uri(url); if(!Allowed(u))throw new Exception("数据地址无效。");
        if(session&&u.Host=="steamcommunity.com")return await SessionGet(u);
        using(var req=new HttpRequestMessage(HttpMethod.Get,u)){
            req.Headers.UserAgent.ParseAdd("SteamCardPlanner/1.0");
            if(u.AbsolutePath=="/market/orderbook"){req.Headers.Add("x-valve-request-type","queryAction"); req.Headers.Referrer=new Uri("https://steamcommunity.com/market/");}
            using(var resp=await http.SendAsync(req)){ if(!resp.IsSuccessStatusCode)throw new Exception(u.Host+" HTTP "+(int)resp.StatusCode); return await resp.Content.ReadAsStringAsync(); }
        }
    }
    async void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e) {
        if(!e.Source.StartsWith(Local+"/",StringComparison.Ordinal))return;
        string id=""; object result=null; string error=null;
        try {
            var msg=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);id=(string)msg["id"];string op=(string)msg["op"];
            if(op=="initial")result=LastSteamId();
            else if(op=="features")result=new {returnReview=true};
            else if(op=="get") result=await Read((string)msg["url"],msg.ContainsKey("session")&&(bool)msg["session"]);
            else if(op=="open"){
                if(msg.ContainsKey("reconcile")&&(bool)msg["reconcile"])reconcileOnReturn=true;
                Open((string)msg["url"]);result=true;
            }
            else if(op=="checkout"){
                ResetFill();fillUrl=(string)msg["url"];
                reconcileOnReturn=true;
                orderSummary=msg.ContainsKey("summary")?(string)msg["summary"]:"本批购买清单";
                orderHint.Text=orderSummary+"\n在 Steam 确认后点左上「返回并核对进度」。";
                Uri target;
                if(Uri.TryCreate(fillUrl,UriKind.Absolute,out target)&&target.Scheme=="https"&&target.Host=="steamcommunity.com"&&target.IsDefaultPort&&msg.ContainsKey("currency")&&msg.ContainsKey("account")){
                    string path=target.AbsolutePath.TrimEnd('/');
                    singleBuyOrder=path.StartsWith("/market/listings/753/",StringComparison.Ordinal);
                    if(singleBuyOrder||path=="/market/multibuy"){
                        fillPayload=json.Serialize(new {account=msg["account"],currency=msg["currency"],rows=msg["rows"]});
                    }
                    if(singleBuyOrder){
                        orderHint.Text=orderSummary+"\n打开 Steam 求购弹窗后，可填入右侧清单。";
                        fillOrder.Visible=true;
                        object next;
                        if(msg.TryGetValue("nextBidIndex",out next)&&next is int){
                            nextBidIndex=(int)next;nextBuyOrder.Visible=true;
                        }
                    }
                }
                orderGrid.Rows.Clear();
                foreach(Dictionary<string,object> row in (System.Collections.IEnumerable)msg["rows"]){
                    int idx=orderGrid.Rows.Add(row["name"],row["qty"],row["formatted"]);orderGrid.Rows[idx].Tag=row["value"];
                }
                Open((string)msg["url"]);result=true;
            }
            else if(op=="clearOrder"){ResetFill();orderGrid.Rows.Clear();orderPanel.Visible=false;reconcileOnReturn=false;workbench.Text="配卡工作台";result=true;}
            else if(op=="tab"){ShowSteam(true);result=true;}
            else throw new Exception("未知操作。");
        } catch(Exception ex){error=ex.GetBaseException().Message;}
        if(!IsDisposed&&ui.CoreWebView2!=null)ui.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {id=id,result=result,error=error}));
    }
}

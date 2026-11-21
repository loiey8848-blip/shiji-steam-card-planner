using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

sealed class NavTabButton : Button {
    readonly Timer fadeTimer = new Timer {Interval=16};
    bool active,hovering,animated;
    float glow;
    Point pointer;

    internal Func<bool> CanAnimate { get; set; }
    internal bool Active {
        get { return active; }
        set {
            if(active==value)return;
            active=value;
            AccessibleDescription=value?"当前页签":null;
            Invalidate();
        }
    }

    internal NavTabButton() {
        SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw,true);
        FlatStyle=FlatStyle.Flat;
        UseVisualStyleBackColor=false;
        Cursor=Cursors.Hand;
        fadeTimer.Tick+=(sender,args)=>StepGlow();
    }

    protected override void OnMouseEnter(EventArgs e) {
        base.OnMouseEnter(e);
        hovering=true;
        animated=(CanAnimate==null||CanAnimate())&&!SystemInformation.HighContrast;
        pointer=animated?PointToClient(Control.MousePosition):new Point(Width/2,Height/2);
        RefreshGlow();
    }

    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if(hovering&&animated&&pointer!=e.Location){pointer=e.Location;Invalidate();}
    }

    protected override void OnMouseLeave(EventArgs e) {
        base.OnMouseLeave(e);
        hovering=false;
        RefreshGlow();
    }

    void RefreshGlow() {
        if(animated){fadeTimer.Start();return;}
        glow=hovering?1:0;
        Invalidate();
    }

    void StepGlow() {
        float target=hovering?1:0;
        glow+=(target-glow)*.26f;
        if(Math.Abs(target-glow)<.025f){glow=target;fadeTimer.Stop();}
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e) {
        if(ClientSize.Width<3||ClientSize.Height<3)return;
        var graphics=e.Graphics;
        graphics.Clear(BackColor);
        graphics.SmoothingMode=SmoothingMode.AntiAlias;
        var bounds=new Rectangle(1,1,Width-3,Height-3);
        bool highContrast=SystemInformation.HighContrast;
        using(var shape=Round(bounds,11)){
            if(highContrast){
                using(var fill=new SolidBrush(active?SystemColors.Highlight:SystemColors.Control))
                    graphics.FillPath(fill,shape);
            }else{
                using(var fill=new LinearGradientBrush(bounds,active?Color.FromArgb(92,64,48):Color.FromArgb(56,47,43),
                    active?Color.FromArgb(53,38,28):Color.FromArgb(37,33,31),90f))
                    graphics.FillPath(fill,shape);
                if(glow>0&&Enabled)DrawSpotlight(graphics,shape,bounds);
            }
            Color edge=highContrast?SystemColors.ControlText:active?Color.FromArgb(225,161,108):Color.FromArgb(119,92,75);
            using(var outline=new Pen(edge))graphics.DrawPath(outline,shape);
        }
        Color ink=highContrast?(active?SystemColors.HighlightText:SystemColors.ControlText):
            Enabled?ForeColor:Color.FromArgb(160,139,126);
        TextRenderer.DrawText(graphics,Text,Font,bounds,ink,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine);
        if(Focused&&ShowFocusCues)ControlPaint.DrawFocusRectangle(graphics,Rectangle.Inflate(bounds,-4,-4),ink,BackColor);
    }

    void DrawSpotlight(Graphics graphics,GraphicsPath shape,Rectangle bounds) {
        float x=Math.Min(bounds.Right,Math.Max(bounds.Left,pointer.X));
        float y=Math.Min(bounds.Bottom,Math.Max(bounds.Top,pointer.Y));
        using(var circle=new GraphicsPath()){
            circle.AddEllipse(x-69,y-43,138,86);
            using(var light=new PathGradientBrush(circle)){
                light.CenterPoint=new PointF(x,y);
                light.CenterColor=Color.FromArgb((int)(93*glow),255,180,113);
                light.SurroundColors=new[]{Color.FromArgb(0,255,180,113)};
                var state=graphics.Save();
                graphics.SetClip(shape,CombineMode.Intersect);
                graphics.FillPath(light,circle);
                graphics.Restore(state);
            }
        }
    }

    static GraphicsPath Round(Rectangle bounds,int radius) {
        int size=Math.Min(radius*2,Math.Min(bounds.Width,bounds.Height));
        var shape=new GraphicsPath();
        shape.AddArc(bounds.Left,bounds.Top,size,size,180,90);
        shape.AddArc(bounds.Right-size,bounds.Top,size,size,270,90);
        shape.AddArc(bounds.Right-size,bounds.Bottom-size,size,size,0,90);
        shape.AddArc(bounds.Left,bounds.Bottom-size,size,size,90,90);
        shape.CloseFigure();
        return shape;
    }

    protected override void Dispose(bool disposing) {
        if(disposing)fadeTimer.Dispose();
        base.Dispose(disposing);
    }
}

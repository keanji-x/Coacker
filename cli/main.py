import argparse
import sys
import os

from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown

from core.backend import create_backend
from core.config import load_config, get_review_config, get_output_config
from core.pipeline import ReviewPipeline

console = Console()


def print_banner():
    console.print(Panel.fit(
        "[bold cyan]AI Heuristic Code Review Agent[/bold cyan]\n"
        "[dim]Multi-Agent System with Bash Tool Backend[/dim]",
        border_style="cyan",
    ))
    console.print()


def make_callbacks():
    """创建 Pipeline 回调，用于实时输出进度"""
    def on_start(task_id: str):
        console.print(f"  [yellow]▶[/yellow] [bold]{task_id}[/bold] starting...")

    def on_done(task_id: str, result):
        icon = "[green]✓[/green]" if result.status == "success" else "[red]✗[/red]"
        console.print(f"  {icon} [bold]{task_id}[/bold] — {result.duration_ms}ms, {len(result.steps)} steps")

    return on_start, on_done


def run(project_path: str, entry_file: str, intent: str, backend_type: str = "",
        verbose: bool = False, output_dir: str = ""):
    print_banner()

    # 加载配置
    config = load_config()
    if backend_type:
        config.setdefault("backend", {})["type"] = backend_type

    backend = create_backend(config)

    # 解析路径
    project_path = os.path.abspath(project_path)
    if output_dir:
        output_dir = os.path.abspath(output_dir)

    console.print(f"  [dim]Backend:[/dim]    {backend.name()}")
    console.print(f"  [dim]Project:[/dim]    {project_path}")
    if entry_file:
        console.print(f"  [dim]Entry:[/dim]      {entry_file}")
    console.print(f"  [dim]Intent:[/dim]     {intent}")
    if output_dir:
        console.print(f"  [dim]Output:[/dim]     {output_dir}")
    console.print()

    # entry_file 可选: 如果没指定，agent 会从 project_root 开始探索
    if entry_file:
        entry_abs = os.path.join(project_path, entry_file) if not os.path.isabs(entry_file) else entry_file
        if not os.path.exists(entry_abs):
            console.print(f"[bold yellow]Warning:[/bold yellow] Entry file not found: {entry_abs}, agent will explore from project root")
            entry_file = ""

    on_start, on_done = make_callbacks()

    pipeline_cfg = config.get("pipeline", {})

    pipeline = ReviewPipeline(
        backend=backend,
        project_root=project_path,
        max_concurrency=pipeline_cfg.get("max_concurrency", 4),
        max_gap_rounds=pipeline_cfg.get("max_gap_rounds", 2),
        output_dir=output_dir,
        on_task_start=on_start,
        on_task_done=on_done,
    )

    console.print("[bold green]Running Pipeline...[/bold green]\n")

    try:
        result = pipeline.run(entry_file, intent)
    except Exception as e:
        console.print(f"[bold red]Pipeline Error:[/bold red] {e}")
        import traceback
        traceback.print_exc()
        return

    # 输出报告
    console.print()
    report_md = result.to_markdown(verbose=verbose)

    console.print(Panel("[bold cyan]Code Review Report[/bold cyan]", border_style="cyan", expand=True))
    console.print(Markdown(report_md))

    # 保存最终报告到 output_dir/report.md
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        report_path = os.path.join(output_dir, "report.md")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report_md)
        console.print(f"\n[green]All reports saved to:[/green] {output_dir}/")
        console.print(f"  [dim]Final report:[/dim]  {report_path}")


def main():
    review_cfg = get_review_config()
    output_cfg = get_output_config()

    parser = argparse.ArgumentParser(
        description="AI Heuristic Code Review Agent — Multi-Agent System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ai-reviewer --project /path/to/repo --entry src/main.py --intent "Review auth flow"
  ai-reviewer --entry src/main.py --intent "Check fund transfer" --backend bash
  ai-reviewer --intent "Review API" -v -o ./output
        """,
    )
    parser.add_argument("--project", "-p", default=review_cfg.get("project_path", "."),
                        help="Project root directory (default: from config.toml or cwd)")
    parser.add_argument("--entry", default=review_cfg.get("entry_file", ""),
                        help="Entry file path, relative to project root (default: from config.toml)")
    parser.add_argument("--intent", default=review_cfg.get("intent", ""),
                        help="Description of the business intent (default: from config.toml)")
    parser.add_argument("--backend", default="", choices=["langchain", "bash", ""],
                        help="Backend to use: 'langchain' (Python SDK) or 'bash' (CLI subprocess)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show detailed step-by-step execution logs")
    parser.add_argument("--output-dir", "-o", default=output_cfg.get("output_dir", ""),
                        help="Directory for all reports (default: from config.toml)")

    args = parser.parse_args()

    # intent 可选: 不指定时做全面审计
    intent = args.intent or "Comprehensive code review and security audit"

    run(args.project, args.entry, intent,
        backend_type=args.backend, verbose=args.verbose, output_dir=args.output_dir)


if __name__ == "__main__":
    main()

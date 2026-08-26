import os
import ast
import re
import json
from datetime import datetime

# --- CONFIGURATION ---
# Add any specific broker API function names you use here
BROKER_API_CALLS = ['place_order', 'modify_order', 'cancel_order', 'get_positions', 'get_margins', 'get_order_book', 'get_profile']
PRICE_VARIABLES = ['price', 'target', 'stop_loss', 'sl', 'tp', 'entry', 'exit', 'trigger', 'ltp', 'qty', 'quantity']

class IntradayBotLinter:
    def __init__(self, root_dir):
        self.root_dir = root_dir
        self.report = {
            "scan_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "files_scanned": 0,
            "critical_issues": [],
            "warnings": [],
            "info": []
        }

    def scan_directory(self):
        print(f"Starting Intraday Bot Linter on: {os.path.abspath(self.root_dir)}")
        for root, dirs, files in os.walk(self.root_dir):
            # Skip virtual environments and hidden folders
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['venv', 'env', '__pycache__', 'node_modules']]
            for file in files:
                if file.endswith('.py') and file != 'intraday_linter.py':
                    filepath = os.path.join(root, file)
                    self._analyze_file(filepath)
        
        self._generate_report()

    def _analyze_file(self, filepath):
        self.report["files_scanned"] += 1
        rel_path = os.path.relpath(filepath, self.root_dir)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                source_code = f.read()
                lines = source_code.splitlines()
        except Exception as e:
            self.report["critical_issues"].append(f"[{rel_path}] Could not read file: {e}")
            return

        # 1. REGEX CHECKS (Fast pattern matching)
        self._check_hardcoded_secrets(rel_path, lines)
        self._check_floating_point_math(rel_path, lines)
        self._check_print_statements(rel_path, lines)

        # 2. AST CHECKS (Structural analysis)
        try:
            tree = ast.parse(source_code)
            self._check_infinite_loops(rel_path, tree)
            self._check_blocking_sleeps(rel_path, tree)
            self._check_broker_api_error_handling(rel_path, source_code, lines)
        except SyntaxError as e:
            self.report["critical_issues"].append(f"[{rel_path}] SYNTAX ERROR at line {e.lineno}: {e.msg}")

    def _check_hardcoded_secrets(self, rel_path, lines):
        secret_pattern = re.compile(r'(api_key|secret_key|token|password|auth_token)\s*=\s*["\'][a-zA-Z0-9_\-]{8,}["\']', re.IGNORECASE)
        for i, line in enumerate(lines, 1):
            if not line.strip().startswith('#'):
                if secret_pattern.search(line):
                    self.report["critical_issues"].append(f"[{rel_path}:{i}] HARDCODED SECRET DETECTED. Use os.getenv() instead.")

    def _check_floating_point_math(self, rel_path, lines):
        # Looks for == or != comparing price-like variables
        price_eq_pattern = re.compile(rf'({"|".join(PRICE_VARIABLES)})\s*(==|!=)\s*', re.IGNORECASE)
        for i, line in enumerate(lines, 1):
            if not line.strip().startswith('#'):
                if price_eq_pattern.search(line):
                    self.report["warnings"].append(f"[{rel_path}:{i}] FLOATING POINT EQUALITY CHECK. Use >=, <=, or math.isclose() for prices/quantities.")

    def _check_print_statements(self, rel_path, lines):
        for i, line in enumerate(lines, 1):
            # Simple check for print() calls, ignoring commented lines
            if re.search(r'\bprint\s*\(', line) and not line.strip().startswith('#'):
                self.report["warnings"].append(f"[{rel_path}:{i}] PRINT STATEMENT FOUND. Use the `logging` module for production bots.")

    def _check_infinite_loops(self, rel_path, tree):
        for node in ast.walk(tree):
            if isinstance(node, ast.While):
                # Check if it's a `while True:` loop
                if isinstance(node.test, ast.Constant) and node.test.value is True:
                    # Check if there is a sleep or yield inside the loop
                    has_sleep = False
                    for child in ast.walk(node):
                        if isinstance(child, ast.Call):
                            if isinstance(child.func, ast.Attribute) and child.func.attr in ['sleep']:
                                has_sleep = True
                            elif isinstance(child.func, ast.Name) and child.func.id in ['sleep']:
                                has_sleep = True
                    if not has_sleep:
                        self.report["critical_issues"].append(f"[{rel_path}] INFINITE LOOP WITHOUT SLEEP. `while True:` found without time.sleep() or await asyncio.sleep(). This will freeze your CPU and broker connection.")

    def _check_blocking_sleeps(self, rel_path, tree):
        # Just flags time.sleep() so the user can verify it's not in an async context
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute) and node.func.attr == 'sleep':
                    if isinstance(node.func.value, ast.Name) and node.func.value.id == 'time':
                        self.report["info"].append(f"[{rel_path}] time.sleep() detected. Ensure this is NOT inside an asyncio event loop or UI thread.")

    def _check_broker_api_error_handling(self, rel_path, source_code, lines):
        # Heuristic: Count broker API calls vs try/except blocks
        api_calls_count = sum(source_code.lower().count(api) for api in BROKER_API_CALLS)
        try_blocks_count = source_code.count('try:') + source_code.count('try :')
        
        if api_calls_count > 0 and try_blocks_count == 0:
            self.report["critical_issues"].append(f"[{rel_path}] UNHANDLED BROKER APIS. Found {api_calls_count} broker API calls but ZERO try/except blocks. A single API timeout will crash the bot.")
        elif api_calls_count > try_blocks_count * 2:
            self.report["warnings"].append(f"[{rel_path}] LOW ERROR HANDLING RATIO. Found {api_calls_count} broker API calls but only {try_blocks_count} try/except blocks. Ensure every API call is wrapped.")

    def _generate_report(self):
        report_text = [
            "="*60,
            "INTRADAY BOT LINTER REPORT",
            f"Scan Time: {self.report['scan_time']}",
            f"Files Scanned: {self.report['files_scanned']}",
            "="*60,
            "",
            f"🚨 CRITICAL ISSUES ({len(self.report['critical_issues'])}):",
            "-"*40
        ]
        if self.report['critical_issues']:
            report_text.extend(self.report['critical_issues'])
        else:
            report_text.append("None found. Excellent!")
            
        report_text.extend(["", f"⚠️ WARNINGS ({len(self.report['warnings'])}):", "-"*40])
        if self.report['warnings']:
            report_text.extend(self.report['warnings'])
        else:
            report_text.append("None found.")
            
        report_text.extend(["", f"ℹ️ INFO / MANUAL CHECKS ({len(self.report['info'])}):", "-"*40])
        if self.report['info']:
            report_text.extend(self.report['info'])
        else:
            report_text.append("None found.")
            
        report_text.extend(["", "="*60, "END OF REPORT", "="*60])
        
        final_report = "\n".join(report_text)
        
        with open("linter_report.txt", "w", encoding="utf-8") as f:
            f.write(final_report)
            
        print("\n" + final_report)
        print("\n✅ Report saved to 'linter_report.txt'. Please copy its contents and share it with the AI.")

if __name__ == "__main__":
    # Scans the current directory where the script is run
    linter = IntradayBotLinter(".")
    linter.scan_directory()
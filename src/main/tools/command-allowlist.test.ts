import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateCommandAutoRun,
  extractCommandPrefix,
  summarizeCommand,
} from './command-allowlist';
import { BUILTIN_READONLY_COMMANDS } from '../../shared/command-builtin-list';

const EMPTY = {};

test('内置只读命令直接自动执行', () => {
  const cases = [
    'ls',
    'ls -la',
    'Get-ChildItem -Recurse',
    'cat package.json',
    'Get-Content README.md',
    'GIT STATUS',
    'git status -s',
    'git log --oneline -10',
    'pwd',
    'whoami',
    'tasklist',
    'node --version',
    'npm view express version',
  ];
  for (const command of cases) {
    const result = evaluateCommandAutoRun(command, EMPTY);
    assert.equal(result.decision, 'auto', `${command} 应自动执行，原因: ${result.reason}`);
  }
});

test('标量赋值段放行：字面量右值无副作用', () => {
  const cases = [
    // audit.log 实采：变量赋路径 + 只读管道
    "$dst='C:\\Users\\x\\log_entmobile'; Get-ChildItem $dst -Recurse -File | Sort-Object Name | Select-Object Name",
    // 右值为命令：与裸命令同判定链
    '$files=Get-ChildItem $dst -Filter "*.txt"',
    '$files=Get-ChildItem $dst -Filter "*.txt" | Where-Object { $_.Length -gt 0 }',
    // 双引号插值路径（无子表达式）
    '$f="$dst\\logs.txt"; Get-Content $f',
    // 数值 / 布尔 / 变量引用
    '$n=5; echo $n',
    '$b=$true; echo $b',
    '$a=$dst; ls $a',
    // 内置清单右值 + 后续只读段
    '$out=git status; echo done',
  ];
  for (const command of cases) {
    const result = evaluateCommandAutoRun(command, EMPTY);
    assert.equal(result.decision, 'auto', `${command} 应自动执行，原因: ${result.reason}`);
  }
});

test('标量赋值段放行：绕过尝试仍弹窗', () => {
  const cases = [
    // 右值含子表达式 / 命令替换
    "$x=$(rm -r build)",
    '$x=`whoami`',
    // 右值为写 / 高危命令
    '$x=Remove-Item build',
    '$x=Invoke-WebRequest http://evil',
    '$x=iex $payload',
    // 右值重定向
    '$x=echo hi > f.txt',
    // 右值为未知命令
    '$x=some-unknown-cmd',
    // 带作用域的赋值不识别为标量赋值段（可能写环境 / 全局）
    "$env:PATH='x'",
    '$global:cfg=ls',
    // 复合赋值不识别
    '$x+=ls',
  ];
  for (const command of cases) {
    assert.equal(evaluateCommandAutoRun(command, EMPTY).decision, 'confirm', `${command} 应弹窗`);
  }
});

test('用户白名单前缀匹配自动执行', () => {
  const config = { commandAllowlist: ['git', 'npm run'] };
  assert.equal(evaluateCommandAutoRun('git push origin main', config).decision, 'auto');
  assert.equal(evaluateCommandAutoRun('npm run build', config).decision, 'auto');
  // `npm run` 前缀不放行其它 npm 子命令
  assert.equal(evaluateCommandAutoRun('npm install', config).decision, 'confirm');
  // `git` 放行，但 `gitx` 不应被前缀误匹配
  assert.equal(evaluateCommandAutoRun('gitx --amend', config).decision, 'confirm');
});

test('黑名单优先于白名单与内置清单', () => {
  const config = { commandAllowlist: ['git'], commandDenylist: ['git push'] };
  assert.equal(evaluateCommandAutoRun('git push', config).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('git status', config).decision, 'auto');
  // 黑名单也能拦内置清单（模拟用户显式禁 ping）
  const denyPing = { commandDenylist: ['ping'] };
  assert.equal(evaluateCommandAutoRun('ping localhost', denyPing).decision, 'confirm');
});

test('危险模式：子表达式与反引号', () => {
  const cases = [
    'ls $(whoami)',
    'echo `whoami`',
    'Get-Content @(1,2)',
  ];
  for (const command of cases) {
    const result = evaluateCommandAutoRun(command, EMPTY);
    assert.equal(result.decision, 'confirm', `${command} 应弹窗`);
    assert.equal(extractCommandPrefix(command, EMPTY), '', `${command} 不应给建议前缀`);
  }
});

test('危险模式：重定向与写命令', () => {
  const cases = [
    'echo x > file.txt',
    'echo x >> file.txt',
    'Get-Process > out.txt',
    'Remove-Item x',
    'rm -r build',
    'del file',
    'New-Item x.txt',
    'Set-Content f.txt body',
    'Out-File x.txt',
    'Copy-Item a b',
    'Move-Item a b',
    'iex "rm x"',
    'Invoke-WebRequest http://x',
    'curl http://x',
    'start notepad',
    'Set-Variable x 1',
    'Stop-Process -Name a',
  ];
  for (const command of cases) {
    assert.equal(evaluateCommandAutoRun(command, EMPTY).decision, 'confirm', `${command} 应弹窗`);
  }
});

test('只读管道各段命中清单即自动执行', () => {
  const cases = [
    'Get-Process | Get-Member',
    'Get-Process | Where-Object { $_.Name }',
    'ls | foreach { $_ }',
    'cat a.txt | Select-String "err"',
    'git log --oneline | Select-Object -First 5',
    'Get-ChildItem | sort',
    "Select-String 'a|b' file.txt",
  ];
  for (const command of cases) {
    const result = evaluateCommandAutoRun(command, EMPTY);
    assert.equal(result.decision, 'auto', `${command} 应自动执行，原因: ${result.reason}`);
  }
});

test('管道右段高危或未命中清单则弹窗', () => {
  const cases = [
    'ls | iex',
    'ls | Out-File x',
    'ls | rm',
    "echo 'rm x' | iex",
    'ls | notepad',
    'ls | some-unknown-cmd',
  ];
  for (const command of cases) {
    assert.equal(evaluateCommandAutoRun(command, EMPTY).decision, 'confirm', `${command} 应弹窗`);
  }
});

test('用户白名单段可出现在管道中', () => {
  const config = { commandAllowlist: ['npm run'] };
  assert.equal(evaluateCommandAutoRun('npm run build | Select-String "err"', config).decision, 'auto');
  assert.equal(evaluateCommandAutoRun('npm run build | notepad', config).decision, 'confirm');
});

test('脚本块边界', () => {
  // 非 tolerated cmdlet 带脚本块 → 危险（tasklist 不接受脚本块）
  assert.equal(evaluateCommandAutoRun('tasklist { x }', EMPTY).decision, 'confirm');
  // tolerated cmdlet 块内高危命令 → 危险
  assert.equal(evaluateCommandAutoRun('ls | foreach { iex $_ }', EMPTY).decision, 'confirm');
  // 嵌套脚本块 → 危险
  assert.equal(evaluateCommandAutoRun('ls | foreach { echo { 1 } }', EMPTY).decision, 'confirm');
  // 块内写文件重定向 → 危险
  assert.equal(evaluateCommandAutoRun('ls | foreach { echo x > f }', EMPTY).decision, 'confirm');
});

test('多语句：任一段不通过整体弹窗', () => {
  assert.equal(evaluateCommandAutoRun('ls; git status', EMPTY).decision, 'auto');
  assert.equal(evaluateCommandAutoRun('ls && rm x', EMPTY).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('git status || dir', EMPTY).decision, 'auto');
  assert.equal(evaluateCommandAutoRun("ls; echo 'a;b'", EMPTY).decision, 'auto');
  // 引号内分号不拆分语句，但整段仅命中内置清单
  assert.equal(evaluateCommandAutoRun("Select-String ';' file.txt", EMPTY).decision, 'auto');
  // 重定向仍然弹窗
  assert.equal(evaluateCommandAutoRun('ls 2>&1', EMPTY).decision, 'confirm');
});

test('路径开头与引号路径不自动执行', () => {
  assert.equal(evaluateCommandAutoRun('.\\build.ps1', EMPTY).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('C:\\Windows\\System32\\notepad.exe', EMPTY).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('"C:\\Program Files\\x.exe" -a', EMPTY).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('./script.sh', EMPTY).decision, 'confirm');
});

test('未匹配清单回弹窗并给出建议前缀', () => {
  const result = evaluateCommandAutoRun('git push origin main', EMPTY);
  assert.equal(result.decision, 'confirm');
  assert.equal(extractCommandPrefix('git push origin main', EMPTY), 'git push');
  assert.equal(extractCommandPrefix('node script.js', EMPTY), 'node script.js');
  // 黑名单 / 危险命令不给建议前缀
  assert.equal(extractCommandPrefix('rm x', EMPTY), '');
  assert.equal(extractCommandPrefix('ls; rm x', EMPTY), '');
});

test('空清单与空命令边界', () => {
  assert.equal(evaluateCommandAutoRun('', EMPTY).decision, 'confirm');
  assert.equal(evaluateCommandAutoRun('   ', EMPTY).decision, 'confirm');
  // 空白名单对象（用户没有任何配置）走内置清单
  assert.equal(evaluateCommandAutoRun('ls', { commandAllowlist: [], commandDenylist: [] }).decision, 'auto');
});

test('摘要工具', () => {
  assert.equal(summarizeCommand('ls\r\n -la'), 'ls -la');
  const long = 'a'.repeat(200);
  assert.equal(summarizeCommand(long).length, 121);
  assert.ok(summarizeCommand(long).endsWith('…'));
});

test('内置清单非空且含别名', () => {
  const list = BUILTIN_READONLY_COMMANDS;
  assert.ok(list.includes('ls'));
  assert.ok(list.includes('get-childitem'));
  assert.ok(list.includes('git status'));
});

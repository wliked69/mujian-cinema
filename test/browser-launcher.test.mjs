import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows 浏览器启动：固定安全 URL、直接打开浏览器、自动回退、显式选择和剪贴板入口', {skip:process.platform!=='win32',timeout:30000}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-browser-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const runner=path.join(dir,'BrowserTest.cs'),exe=path.join(dir,'test.exe');
  await fs.writeFile(runner,`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
class BrowserTest {
  static void Check(bool value) { if(!value)throw new Exception("browser assertion failed"); }
  static void Main(string[] args) {
    Check(ScreenRoomBrowser.Address(3210,"/admin")=="http://127.0.0.1:3210/admin");
    foreach(string page in new[]{"https://evil.test","/admin?x=1","/ & calc.exe"}) { bool rejected=false;try{ScreenRoomBrowser.Address(3210,page);}catch(ArgumentException){rejected=true;}Check(rejected); }
    bool invalid=false;try{ScreenRoomBrowser.Address(0,"/");}catch(ArgumentException){invalid=true;}Check(invalid);
    var auto=new ScreenRoomBrowserChoice("auto",null);var chrome=new ScreenRoomBrowserChoice("chrome",@"C:\\BrowserTest\\chrome.exe");var edge=new ScreenRoomBrowserChoice("edge",@"C:\\BrowserTest\\msedge.exe");
    int calls=0;string chosen=ScreenRoomBrowser.Open(4321,"/admin",auto,new[]{auto,chrome,edge},p=>{calls++;Check(!p.UseShellExecute);Check(p.Arguments=="\\\"http://127.0.0.1:4321/admin\\\"");return calls==2;});Check(chosen=="edge"&&calls==2);
    calls=0;chosen=ScreenRoomBrowser.Open(4321,"/",chrome,new[]{auto,edge},p=>{calls++;return true;});Check(chosen=="chrome"&&calls==1);
    calls=0;chosen=ScreenRoomBrowser.Open(4321,"/",auto,new[]{auto},p=>{calls++;Check(p.UseShellExecute&&p.FileName=="http://127.0.0.1:4321/");return true;});Check(calls==1);
    bool failed=false;try{ScreenRoomBrowser.Open(4321,"/",chrome,new[]{auto,edge},p=>false);}catch(InvalidOperationException){failed=true;}Check(failed);
    Check(ScreenRoomBrowser.Choices().Count>=1);
    string project=Path.Combine(args[0],"backup-project");Directory.CreateDirectory(Path.Combine(project,"data","actors"));
    File.WriteAllText(Path.Combine(project,"data","library.json"),"{}");File.WriteAllBytes(Path.Combine(project,"data","actors","portrait.png"),new byte[]{1,2,3});
    string backup=Path.Combine(args[0],"backup.zip");ScreenRoomBackup.Create(project,backup);
    using(var archive=ZipFile.OpenRead(backup)){Check(archive.GetEntry("data/actors/portrait.png")!=null);Check(archive.GetEntry("data/library.json")!=null);}
    Console.WriteLine("BROWSER TESTS PASSED");
  }
}`);
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const compiled=spawnSync(compiler,['/nologo','/codepage:65001','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/out:'+exe,fileURLToPath(new URL('../scripts/ScreenRoomBrowser.cs',import.meta.url)),fileURLToPath(new URL('../scripts/ScreenRoomBackup.cs',import.meta.url)),runner],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(compiled.status,0,compiled.stdout+'\n'+compiled.stderr);
  const run=spawnSync(exe,[dir],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/BROWSER TESTS PASSED/);
  const panel=await fs.readFile(new URL('../scripts/ScreenRoomPanel.cs',import.meta.url),'utf8');assert.match(panel,/ScreenRoomBrowser\.Open/);assert.match(panel,/Clipboard\.SetText/);assert.match(panel,/DropDownList/);
});

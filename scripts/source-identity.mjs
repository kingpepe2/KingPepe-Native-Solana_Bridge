// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only Git identity for ordinary clones and Windows worktrees under WSL.
import {execFileSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
export function sourceIdentity(root) {
  const args=[];
  if(process.platform==='linux') {
    const dotgit=path.join(root,'.git');
    if(statSync(dotgit).isFile()) {
      const text=readFileSync(dotgit,'utf8');
      const match=/^gitdir: ([A-Za-z]):[\\/]([^\r\n]+)\r?\n?$/u.exec(text);
      if(match)args.push('--git-dir=/mnt/'+match[1].toLowerCase()+'/'+match[2].replaceAll('\\','/'),'--work-tree='+root);
    }
  }
  const git=extra=>execFileSync('git',[...args,...extra],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const sourceSha=git(['rev-parse','HEAD']);if(!/^[0-9a-f]{40}$/u.test(sourceSha))throw new Error('TestSourceIdentityRejected');
  return {sourceSha,exactSource:git(['status','--porcelain'])===''};
}

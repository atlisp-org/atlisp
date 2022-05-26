#!/bin/sh
# cd ~/
# git clone git@gitee.com:atlisp/atlisp.git 
cd ~/atlisp
git submodule update --init --recursive
git submodule foreach git checkout main
git submodule foreach git pull --rebase origin main
echo Sync all submodules.

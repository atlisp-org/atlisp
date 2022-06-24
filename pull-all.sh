#!/bin/sh
# cd ~/
# git clone git@gitee.com:atlisp/atlisp.git 
cd ~/atlisp
git pull
git submodule update --init --recursive
#git submodule foreach git checkout main
git submodule foreach git pull
echo Sync all submodules.
sleep 5

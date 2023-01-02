#!/bin/sh

cd ~/atlisp
git submodule sync --recursive
git submodule update --init --recursive
# git submodule foreach git checkout main
git submodule foreach git pull --rebase origin main
echo Sync all submodules.

#!/bin/sh
cd ~/
git clone git@gitee.com:atlisp/atlisp.git 
cd atlisp
git submodule update --init
cd packages
git submodule update --init 

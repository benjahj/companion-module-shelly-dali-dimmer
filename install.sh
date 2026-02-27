#!/bin/bash

# Detect Companion usermodules path
if [ -d "$HOME/.config/companion/usermodules" ]; then
    DEST="$HOME/.config/companion/usermodules/ShellyDimmer"
elif [ -d "$HOME/companion/usermodules" ]; then
    DEST="$HOME/companion/usermodules/ShellyDimmer"
else
    mkdir -p "$HOME/.config/companion/usermodules"
    DEST="$HOME/.config/companion/usermodules/ShellyDimmer"
fi

if [ -d "$DEST" ]; then
    echo "Already installed - updating..."
    cd "$DEST"
    git pull
    npm install
else
    git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git "$DEST"
    cd "$DEST"
    npm install
fi

echo ""
echo "Done! Restart Companion and search for 'Shelly' under Add Connection."


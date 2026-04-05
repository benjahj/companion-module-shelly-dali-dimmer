$dest = "$env:APPDATA\companion\usermodules\ShellyDimmer"

if (Test-Path $dest) {
    Write-Host "Already installed - updating instead..."
    cd $dest
    git pull
    npm install
} else {
    git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git $dest
    cd $dest
    npm install
}

Write-Host ""
Write-Host "Done! Restart Companion and search for 'Shelly' under Add Connection."


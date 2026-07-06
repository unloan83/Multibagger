pushd "\\wsl.localhost\Ubuntu\home\user\projects\Multibagger"
try {
  Write-Host "Deploying from: $(Get-Location)"
  npx vercel --prod --yes
} finally {
  popd
}

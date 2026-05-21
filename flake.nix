{
  description = "meeting-baas-mcp — Meeting BaaS public MCP server (pnpm, tsc)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;
      pkgsFor = s: nixpkgs.legacyPackages.${s};
    in {
      # Standalone pnpm package. `pnpm build` is plain `tsc` → dist/server.js
      # (hermetic: no DB, no fonts, no network). The whole tree (incl deps) is
      # shipped and the wrapper runs the compiled entry; secrets/PORT come from
      # the systemd unit's EnvironmentFile/environment (dotenv/config no-ops
      # without a .env in the store dir).
      packages = forAll (s:
        let pkgs = pkgsFor s; in {
          default = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "mcp-on-vercel";
            version = "0.1.0";
            src = ./.;
            nativeBuildInputs = [ pkgs.nodejs_20 pkgs.pnpm_8.configHook pkgs.makeWrapper ];
            pnpmDeps = pkgs.pnpm_8.fetchDeps {
              inherit (finalAttrs) pname version src;
              fetcherVersion = 2;
              hash = "sha256-5gnYKOFqxdkk/QjtPp1YkMVN0mLY6x3bW6q4GnKNOA8=";
            };
            env = { CI = "true"; };
            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              dir=$out/share/mcp-on-vercel
              mkdir -p "$dir"
              cp -a . "$dir"/
              find "$dir" -xtype l -delete
              makeWrapper ${pkgs.nodejs_20}/bin/node $out/bin/mcp-on-vercel \
                --chdir "$dir" \
                --add-flags "-r dotenv/config $dir/dist/server.js"
              runHook postInstall
            '';
          });
        });
      overlays.default = final: prev: {
        mcp-on-vercel = self.packages.${final.system}.default;
      };
    };
}

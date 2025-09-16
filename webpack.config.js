const HtmlWebpackPlugin = require('html-webpack-plugin');
const copyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const path = require("path");

const panelName = `com.listen2me.jwcustomformula`;

const dist = path.join(__dirname, 'dist');

function createConfig(mode, entry, output, plugins) {
    return {
        entry,
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    use: [ { loader: 'ts-loader', options: { transpileOnly: true, configFile: "tsconfig.json" } }],
                },
                { test: /\.css$/, use: ['style-loader', 'css-loader'] },
                { test: /\.(png|jpg|gif|webp|svg|zip|otf)$/, use: ['url-loader'] },
            ],
        },

        resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'] },
        externals: {
            _require: "require",
            photoshop: 'commonjs photoshop',
            uxp: 'commonjs uxp',
            os: 'commonjs os'
        },
        output: {
            filename: '[name].js',
            path: output
        },

        plugins,
    }
}

module.exports = (env, argv) => {
    const panelOutput = path.join(dist, `${panelName}.unsigned`);
    const uxpPanelConfig = createConfig(argv.mode, 
        // 修改入口名称
        { bundle: "./src/index.tsx" }, 
        path.join(dist, panelName), 
        [
            new webpack.ProvidePlugin({
                _require: "_require"
            }),
            new HtmlWebpackPlugin({
                template: path.join(__dirname, 'src', 'index.html'),
                filename: 'index.html',
                // 修改对应的 chunks 名称
                chunks: ['bundle'],
            }),
        new copyWebpackPlugin({
            patterns: [
                { from: "./manifest.json", to: "." },
                { from: "./src/assets/icons", to: "./icons" },
                // 修改字体文件路径，确保它与实际文件位置匹配
                { from: "./src/assets/fonts", to: "./fonts" },
                { from: "./src/styles", to: "." }
            ]
        }),
    ]);
    return [uxpPanelConfig];
}
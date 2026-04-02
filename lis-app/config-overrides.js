const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = function override(config, env) {
    // Aggiungiamo il plugin per copiare rigorosamente i file binari precompilati .wasm dal node_modules di tfjs
    // direttamente nella cartella build/public, in modo che il web server locale li trovi sempre.
    if (!config.plugins) {
        config.plugins = [];
    }

    config.plugins.push(
        new CopyPlugin({
            patterns: [
                {
                    from: 'node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm',
                    to: 'static/js/[name][ext]',
                },
            ],
        })
    );

    // Forza Webpack a ignorare l'errore di filesystem node (se si impantana su moduli server-side)
    config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        path: false
    };

    return config;
};


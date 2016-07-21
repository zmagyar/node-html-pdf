var path = require('path');

var Promise = require('bluebird');
var BlueBirdQueue = require('bluebird-queue');
var childprocess = require('child_process');
try {
    var phantomjs = require('phantomjs-prebuilt');
} catch (err) {
    console.log('html-pdf: Failed to load PhantomJS module.', err);
}

var queue = new BlueBirdQueue({
    concurrency: 1
});

var child;
var resolver;
var rejecter;

/**
 * Get PDF file path by given HTML source.
 * The method uses a bluebird-queue to process the requests after each other
 * while keeping the same phantomjs process alive.
 *
 * @param html
 * @param id
 * @returns {bluebird|exports|module.exports}
 */
var getPdf = function (html, id) {
    id = id || parseInt(Math.random() * 10000000);
    return new Promise(function (resolve, reject) {
        var promise = function () {
            return _sendDataToPhantomProcess(html, {
                id: id,
                timeout: 15000
            })
                .then(resolve)
                .catch(reject);
        };
        queue.addNow(promise);
    });
};

/**
 * Kill phantomjs process if process exits.
 */
process.on('exit', function () {
    if (child) {
        child.kill();
    }
});

/**
 * Start phantomjs process
 * @returns {*}
 * @private
 */
var _startPhantomProcess = function () {
    var scriptPath = path.join(__dirname, 'scripts', 'pdf_a4_portrait.js');
    var phantomPath = phantomjs.path;

    child = childprocess.spawn(phantomPath, [scriptPath]);
    child.stdout.on('data', function (buffer) {
        var data = buffer.toString();
        var jsonData = JSON.parse(data);
        if (jsonData.filename) {
            resolver(jsonData);
        } else {
            rejecter(new Error(data));
        }
    });

    child.stderr.on('data', function (buffer) {
        var data = buffer.toString();
        console.log('Phantom process error: ', data);
        rejecter(new Error('Error in phantomjs process'));
        child.kill();
    });
    return child;
};

/**
 * Send data to phantom process
 * @param html
 * @param options
 * @returns {bluebird|exports|module.exports}
 * @private
 */
var _sendDataToPhantomProcess = function (html, options) {
    return new Promise(function (resolve, reject) {
        if (!child || child.killed) {
            child = _startPhantomProcess();
        }
        child.stdin.write(JSON.stringify({
                html: html,
                options: options
            }) + '\n', 'utf8');

        resolver = function (data) {
            resolve(data);
        };

        rejecter = function (error) {
            reject(error);
        };
    });
};

module.exports.getPdf = getPdf;

var path = require('path');
var fs = require('fs');

var Promise = require('bluebird');
var BlueBirdQueue = require('bluebird-queue');
var childprocess = require('child_process');
var Debug = require('debug');

var debugInfo = Debug('html-pdf:info');
var debugVerbose = require('debug')('html-pdf:verbose');

try {
    var phantomjs = require('phantomjs-prebuilt');
} catch (err) {
    console.log('html-pdf: Failed to load PhantomJS module.', err);
}

var queue = new BlueBirdQueue({
    concurrency: 1
});

var child;
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
        debugInfo('getPdf called');
        debugVerbose('getPdf', html, id);
        var promise = function () {


            return _findPhantomProcess()
                .then(function () {
                    return _sendDataToPhantomProcess(html, {
                        id: id
                    });
                })
                .then(function (pdfData) {
                    if (pdfData.id === id) {
                        resolve(pdfData);
                    } else {
                        reject(new Error('PDF generation error'));
                    }
                })
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

    return new Promise(function (resolve, reject) {
        debugInfo('Spawning new phantomjs process', phantomPath, [scriptPath]);
        child = childprocess.spawn(phantomPath, [scriptPath, 30000, 1000 * 60 * 60]);


        child.stdout.on('data', function (buffer) {
            var data = buffer.toString();
            debugVerbose('PhantomJS process onData', data);
        });

        var interval = setInterval(function () {
            try {
                child.stdin.write('\n', 'utf8');
            } catch (err) {
                if (typeof child.kill === 'function') {
                    debugInfo('Could not write to PhantomJS process, cleaning up', err);
                    clearInterval(interval);
                    child.kill();
                }
                child.killed = true;
            }
        }, 100);


        child.on('error', function (error) {
            debugInfo('PhantomJS process onError', error);
            clearInterval(interval);
            child.kill();
            child.killed = true;
        });


        debugInfo('PhantomJS process has been started');

        resolve(child);


    });


};


var _findPhantomProcess = function () {
    if (!child || child.killed) {
        return _startPhantomProcess();
    } else {
        debugInfo('PhantomJS process already running, reusing it');
        return Promise.resolve(child);
    }
}

/**
 * Send data to phantom process
 * @param html
 * @param options
 * @returns {bluebird|exports|module.exports}
 * @private
 */
var _sendDataToPhantomProcess = function (html, options) {


    return new Promise(function (resolve, reject) {
        var removeListeners = function (keepExit) {
            debugInfo('Removing listeners from PhantomJS process');
            if (child) {
                child.stdout.removeListener('data', dataHandler);
                child.stderr.removeListener('data', errorHandler);
                if (!keepExit) {
                    child.removeListener('exit', exitHandler);
                }
            } else {
                debugInfo('PhantomJS child process was already destroyed');
            }
        }
        var errorHandler = function (buffer) {
            var data = buffer.toString();
            debugInfo('PhantomJS process error: ', data);
            reject(new Error('PhantomJS process error.'));
            if (typeof child.kill === 'function') {
                removeListeners(true);
                debugInfo('Killing PhantomJS process');
                child.kill();
            }

            child = false;
        };

        var dataHandler = function (buffer) {
            debugInfo('Response from PhantomJS')
            var data = buffer.toString();
            try {
                var jsonData = JSON.parse(data);
                if (jsonData.filename) {
                    debugInfo('Decoded data from response', data);
                    removeListeners(true);
                    resolve(jsonData);
                }
                if (jsonData.log) {
                    debugInfo('PhantomJS process log:', jsonData.log);
                }
            } catch (err) {
                debugInfo('PhantomJS response parse error', err);
                debugInfo('Original data', data);
            }
        };
        var exitHandler = function () {
            debugInfo('PhantomJS process exit', arguments);
            removeListeners();
            child = false;
            reject();
        }
        child.stdin.write(JSON.stringify({
                html: html,
                options: options
            }) + '\n', 'utf8');
        debugInfo('Data sent to PhantomJS process');
        child.stdout.on('data', dataHandler);
        child.stderr.on('data', errorHandler);

        child.removeAllListeners('exit');
        child.once('exit', exitHandler);


        debugInfo('Listener added on PhantomJS process');
    });
};

module.exports.getPdf = getPdf;

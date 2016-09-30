var system = require('system')
var webpage = require('webpage')
var options = {};


// Error handler
function exit(error) {
    console.log('PhantomJS error:', error);
    var message
    if (typeof error === 'string') message = error
    if (error) system.stderr.write('html-pdf: ' + (message || 'Unknown Error ' + error) + '\n')
    phantom.exit(error ? 1 : 0)
}

// Build stack to print
function buildStack(msg, trace) {
    var msgStack = [msg]
    if (trace && trace.length) {
        msgStack.push('Stack:')
        trace.forEach(function (t) {
            msgStack.push('  at ' + t.file || t.sourceURL + ': ' + t.line + ' (in function ' + t.function + ')')
        })
    }
    return msgStack.join('\n')
}

phantom.onError = function (msg, trace) {
    exit(buildStack('Script - ' + msg, trace))
};


var json;
var processingId;

var page = webpage.create();

setInterval(function () {
    var line = system.stdin.readLine();

    try {
        json = JSON.parse(line);
    } catch (err) {
        return;
    }
    if (!json.html || !json.html.trim()) {
        return;
    }


    options = json.options || {};
    processingId = json.options.id;

    page.setContent(json.html, null);
    // Force cleanup after 2 minutes
    // Add 2 seconds to make sure master process triggers kill
    // before to the phantom process

}, 100);

page.onError = function (msg, trace) {
    exit(buildStack('Evaluation - ' + msg, trace))
};


// Completely load page & end process
// ----------------------------------
page.onLoadFinished = function (status) {

    // The paperSize object must be set at once
    //
    // This does not work in new phantomjs for some reason(the page looks like printing in landscape to a paper in portrait mode), but
    // just works fine with the defaults.
    // page.paperSize = definePaperSize(getContent(page), options)

    // Output to parent process
    var fileOptions = {
        type: options.type || 'pdf',
        quality: options.quality || 75
    };

    var filename = options.filename || (options.directory || '/tmp') + '/html-pdf-' + processingId + '-' + system.pid + '.' + fileOptions.type
    page.render(filename, fileOptions)
    system.stdout.write(JSON.stringify({filename: filename, id: processingId}));

    //exit(null)
};

// Returns a hash of HTML content
// ------------------------------
function getContent(page) {
    return page.evaluate(function () {
        function getElements(doc, wildcard) {
            var wildcardMatcher = new RegExp(wildcard + '(.*)')
            var hasElements = false
            var elements = {}
            var $elements = document.querySelectorAll("[id*='" + wildcard + "']")

            var $elem, match, i
            var len = $elements.length
            for (i = 0; i < len; i++) {
                $elem = $elements[i]
                match = $elem.attributes.id.value.match(wildcardMatcher)
                if (match) {
                    hasElements = true
                    elements[match[1]] = $elem.outerHTML
                    $elem.parentNode.removeChild($elem)
                }
            }

            if (hasElements) return elements
        }

        function getElement(doc, id) {
            var $elem = doc.getElementById(id)
            if ($elem) {
                var html = $elem.outerHTML
                $elem.parentNode.removeChild($elem)
                return html
            }
        }

        var styles = document.querySelectorAll('link,style')
        styles = Array.prototype.reduce.call(styles, function (string, node) {
            return string + node.outerHTML
        }, '')

        // Wildcard headers e.g. <div id="pageHeader-first"> or <div id="pageHeader-0">
        var header = getElements(document, 'pageHeader-')
        var footer = getElements(document, 'pageFooter-')

        // Default header and footer e.g. <div id="pageHeader">
        var h = getElement(document, 'pageHeader')
        var f = getElement(document, 'pageFooter')

        if (h) {
            header = header || {}
            header.default = h
        }

        if (f) {
            footer = footer || {}
            footer.default = f
        }

        var body
        var $body = document.getElementById('pageContent')
        if ($body) body = $body.outerHTML
        else body = document.body.outerHTML

        return {
            styles: styles,
            header: header,
            body: body,
            footer: footer
        }
    })
}

// Creates page section
// --------------------
function createSection(section, content, options) {
    var c = content[section] || {}
    var o = options[section] || {}

    return {
        height: o.height,
        contents: phantom.callback(function (pageNum, numPages) {
            var html = c[pageNum]
            if (pageNum === 1 && !html) html = c.first
            if (pageNum === numPages && !html) html = c.last
            return (html || c.default || o.contents || '')
                    .replace('{{page}}', pageNum)
                    .replace('{{pages}}', numPages) + content.styles
        })
    }
}

// Creates paper with specified options
// ------------------------------------
function definePaperOrientation(options) {
    var paper = {border: options.border || '0'}

    if (options.height && options.width) {
        paper.width = options.width
        paper.height = options.height
    } else {
        paper.format = options.format || 'A4'
        paper.orientation = options.orientation || 'portrait'
    }

    return paper
}

// Creates paper with generated footer & header
// --------------------------------------------
function definePaperSize(content, options) {
    var paper = definePaperOrientation(options)

    if (options.header || content.header) {
        paper.header = createSection('header', content, options)
    }

    if (options.footer || content.footer) {
        paper.footer = createSection('footer', content, options)
    }

    if (paper.header && paper.header.height === undefined) paper.header.height = '46mm'
    if (paper.footer && paper.footer.height === undefined) paper.footer.height = '28mm'

    return paper
}


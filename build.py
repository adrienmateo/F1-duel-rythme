"""Assemble index.html à partir de src/ (style, page, script). Usage : python3 build.py"""
import os
D = os.path.dirname(os.path.abspath(__file__))
r = lambda p: open(os.path.join(D, p), encoding="utf-8").read()
head = r("src/head.html")
html = head.replace("</style>", r("src/extra.css") + "\n" + r("src/mobile.css") + "\n" + r("src/pace.css") + "\n" + r("src/nav.css") + "\n</style>") + "\n</head>\n<body>\n" + r("src/body.html") + "\n<script>\n" + r("src/app.js") + r("src/mobile.js") + r("src/pace.js") + r("src/nav.js") + "</script>\n</body>\n</html>\n"
open(os.path.join(D, "index.html"), "w", encoding="utf-8").write(html)
print("index.html :", len(html), "caractères")

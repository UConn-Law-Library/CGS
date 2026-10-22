# CGA intermediate certificate

`gdig2.crt.pem` is Go Daddy Secure Certificate Authority - G2, retrieved over verified
HTTPS from https://certs.godaddy.com/repository/gdig2.crt.pem on October 21, 2026.
Its DER SHA-256 fingerprint was checked against GoDaddy's published repository:
https://certs.godaddy.com/repository/

`973a41276ffd01e027a2aad49e34c37846d3e976ff6a620b6712e33832041aa6`

The bundle builder combines this certificate with the locked certifi trust store.
It checks the DER fingerprint on every build, independently of PEM line endings.
Hostname, chain, and expiration verification remain enabled. Replacing the certificate
or fingerprint requires a reviewed source change; workflows never download trust material.

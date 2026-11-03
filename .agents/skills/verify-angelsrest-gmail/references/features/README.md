# Gmail feature map

Scope: the two primary pilot paths, plus existing local regression coverage.
Current provider evidence lives only in the
[launch packet](../../../../../docs/runbooks/gmail-pilot-launch.md).

| Feature | Entry points | Instructions |
|---|---|---|
| Google sign-in and optional Gmail | `/admin`, Google connections, `/admin/google-connection` | [Connection](google-connection.md) |
| Registered conversation and attachments | Inquiry/client detail → Gmail conversations | [Sending and attachments](sending-attachments.md) |

The broader acceptance matrix includes separate-account behavior, realistic file
limits, recovery faults, watch renewal and retention. An unvisited matrix row is
unverified even when related offline tests pass.

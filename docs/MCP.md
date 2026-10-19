mcp需求
1、实现mcp client，mcp client官方文档https://modelcontextprotocol.io/docs/learn/client-concepts
2、实现接入mcp server能力，可参考代码：E:\other-code\ai\mcp\typescript-sdk\examples\client-quickstart\src\index-ds.ts
3、mcp server UI配置，在菜单上提供mcp server配置入口，点击后弹出mcp server配置页面，可在页面上查看mcp server列表，并可增加、修改、删除mcp server；mcp配置格式可参考C:\Users\fangruibin\.comate\mcp.json，配置后保存到C:\Users\【用户名】\.ergaster\mcp.json
4、mcp功能按智能体进行启用/禁用，每个智能体可添加一个或多个mcp server，也可以不配置MCP server；在智能体编辑页面提供mcp选择功能，并可启用/禁用某个mcp；默认智能体也提供mcp选择功能，并可启用/禁用某个mcp；
5、智能体启用某个mcp后，获取该智能体下的所有mcp server提供的工具列表，在会话中将这些工具带给LLM，从而实现智能体拥有不同的工具能力
6、mcp 提供的tools和目前agent提供的tools、以及skills是否需要做区分？

请调研一下实现方案，有不清楚的地方提出来确认
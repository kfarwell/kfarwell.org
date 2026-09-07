defmodule KfarwellWeb.ChatLive do
  @moduledoc """
  The chat window on the desktop.

  Two kinds of conversation share it: the one with me, which goes to a Discord
  thread, and ones between visitors, which never touch Discord and live only in
  PubSub and each browser's storage.
  """

  use KfarwellWeb, :live_view

  alias Kfarwell.Chat
  alias Kfarwell.Presence
  alias KfarwellWeb.Plugs.Visitor

  # The pinned conversation: me, via Discord.
  @host "kfarwell"

  # Keep each conversation (and localStorage) from growing without bound.
  @keep 200

  # Messages per window before a visitor is asked to slow down.
  @burst 5
  @burst_window 10

  @max_image_size 8_000_000

  # Only a backstop; presence updates carry the change.
  @presence_refresh :timer.seconds(30)

  @impl true
  def mount(_params, session, socket) do
    visitor_id = Visitor.from_session(session)

    socket =
      socket
      |> assign(
        visitor_id: visitor_id,
        nickname: "",
        # What others see us called until we pick a nickname.
        default_name: Presence.default_name(visitor_id),
        conversations: %{@host => conversation(@host, "kfarwell")},
        tabs: [@host],
        active: @host,
        buddies: [],
        typing: %{},
        sends: [],
        error: nil,
        sending_image: false,
        online: Chat.available?(),
        host: @host,
        host_status: Chat.host_status(),
        klipy_key: Application.get_env(:kfarwell, :klipy_app_key)
      )
      |> allow_upload(:image,
        accept: ~w(.png .jpg .jpeg .gif .webp),
        max_entries: 1,
        max_file_size: @max_image_size,
        auto_upload: true,
        progress: &handle_progress/3
      )

    if connected?(socket) do
      Chat.subscribe(visitor_id)
      Chat.subscribe_presence()
      :timer.send_interval(@presence_refresh, self(), :refresh_host_status)
      Chat.subscribe_dms(visitor_id)
      Presence.join(visitor_id, "")

      {:ok,
       socket
       |> put_messages(@host, Chat.history(visitor_id))
       |> assign(buddies: Presence.buddies(visitor_id))}
    else
      {:ok, socket}
    end
  end

  defp conversation(id, name), do: %{id: id, name: name, messages: [], unread: false}

  @impl true
  def render(assigns) do
    ~H"""
    <div class="chat" id="chat-root" phx-hook="Chat">
      <div class="field-row chat-nickname">
        <label for="chat-nickname">Nickname:</label>
        <form phx-change="set_nickname" phx-submit="set_nickname">
          <input
            type="text"
            id="chat-nickname"
            name="nickname"
            value={@nickname}
            maxlength="60"
            placeholder={@default_name}
            phx-debounce="600"
          />
        </form>
      </div>

      <div class="chat-body">
        <ul class="tree-view chat-contacts">
          <li :for={{status, label, contacts} <- contact_groups(assigns)}>
            <details open>
              <summary>{label} ({length(contacts)})</summary>
              <ul>
                <li :for={contact <- contacts}>
                  <a
                    href="#"
                    phx-click="open"
                    phx-value-peer={contact.id}
                    class={"chat-contact" <> if(contact.id == @host, do: " host", else: "")}
                  >
                    {contact.name}
                  </a>
                </li>
              </ul>
            </details>
          </li>
        </ul>

        <div class="chat-main">
          <menu role="tablist" id="chat-tabs">
            <li
              :for={tab <- @tabs}
              role="tab"
              aria-selected={to_string(tab == @active)}
              data-tab={tab}
            >
              <a href="#" phx-click="select" phx-value-peer={tab}>
                {tab_name(@conversations, tab)}{if unread?(@conversations, tab), do: " *"}
              </a>
            </li>
          </menu>

          <div class="window chat-panel" role="tabpanel">
            <div class="chat-log" id="chat-log">
              <p :if={@active == nil} class="chat-empty">
                Pick someone from the buddy list to start a conversation.
              </p>
              <div
                :for={message <- messages(@conversations, @active)}
                id={"msg-" <> to_string(@active) <> "-" <> message.id}
                class={"chat-message " <> if(message.from == :visitor, do: "mine", else: "theirs")}
              >
                <span class="chat-author">{author(message, @conversations, @active, @nickname)}</span><span
                  :if={not bare_link?(message)}
                  class="chat-text"
                >{Kfarwell.Markdown.to_html(message.body)}</span>
                <img :if={inline_image(message)} src={inline_image(message)} alt="" loading="lazy" />
              </div>
              <p :if={@typing[@active]} class="chat-typing">
                <em>{@typing[@active]} is typing...</em>
              </p>
            </div>
          </div>
        </div>
      </div>

      <%!-- The hook positions this on right-click. --%>
      <div class="chat-context-menu" id="chat-tab-menu" hidden>
        <button type="button" data-close-tab>Close</button>
      </div>

      <div class="chat-compose">
        <div class="chat-toolbar">
          <button type="button" class="chat-tool" data-wrap="**" title="Bold">
            <strong>B</strong>
          </button>
          <button type="button" class="chat-tool" data-wrap="*" title="Italic">
            <em>I</em>
          </button>
          <button type="button" class="chat-tool" data-wrap="__" title="Underline">
            <u>U</u>
          </button>
          <button type="button" class="chat-tool" data-wrap="~~" title="Strikethrough">
            <s>S</s>
          </button>
          <button type="button" class="chat-tool" data-wrap="`" title="Code">
            <strong>`</strong>
          </button>
          <button type="button" class="chat-tool" data-fence="1" title="Code block">
            <strong>```</strong>
          </button>
          <button type="button" class="chat-tool h1" data-prefix="# " title="Heading 1">H1</button>
          <button type="button" class="chat-tool h2" data-prefix="## " title="Heading 2">H2</button>
          <button type="button" class="chat-tool h3" data-prefix="### " title="Heading 3">H3</button>
          <button type="button" class="chat-tool" data-prefix="- " title="List">&#8226;</button>
          <button type="button" class="chat-tool" data-prefix="&gt; " title="Quote">&#10078;</button>
          <button type="button" class="chat-tool" data-wrap="||" title="Spoiler">
            <span class="chat-block"></span>
          </button>
          <button type="button" class="chat-tool wide" data-link="1" title="Link">URL</button>
          <button type="button" class="chat-tool wide right" data-picker="emoji" title="Emoji">
            ^_^
          </button>
          <button type="button" class="chat-tool wide" data-picker="gif" title="GIFs">GIF</button>
          <%!-- The upload hook reports a chosen file to the enclosing form, so
          there has to be one. Only the Discord conversation can take a file. --%>
          <form class="chat-upload" phx-change="image_chosen" phx-submit="image_chosen">
            <label
              class={"chat-tool wide" <> if(@active == @host, do: "", else: " disabled")}
              title={
                if @active == @host,
                  do: "Send an image",
                  else: "Images can only be sent to kfarwell"
              }
            >
              <span aria-hidden="true">IMG</span>
              <.live_file_input
                upload={@uploads.image}
                class="chat-file"
                disabled={@active != @host}
              />
            </label>
          </form>
        </div>

        <%!-- phx-update="ignore" spares an element's children but still patches
        its own attributes, so `hidden` lives on the inner element. --%>
        <div id="chat-emoji" phx-update="ignore">
          <div class="chat-picker" data-panel="emoji" hidden>
            <form class="chat-picker-search" data-emoji-search>
              <input type="text" name="query" placeholder="Search emoji" aria-label="Search emoji" />
            </form>
            <div class="chat-picker-grid chat-emoji-grid" data-emoji-results></div>
            <p class="chat-picker-note" data-emoji-note hidden></p>
          </div>
        </div>

        <%!-- KLIPY requires requests to come from the visitor's browser, so the
        search lives in the hook. --%>
        <div id="chat-gif" phx-update="ignore">
          <div
            class="chat-picker"
            data-panel="gif"
            hidden
            data-klipy-key={@klipy_key}
            data-customer={@visitor_id}
          >
            <form class="chat-gif-search" data-gif-search>
              <input type="text" name="query" placeholder="Search KLIPY" aria-label="Search KLIPY" />
              <button type="submit">Search</button>
            </form>
            <div class="chat-picker-grid chat-gif-grid" data-gif-results></div>
            <p class="chat-picker-note" data-gif-note hidden></p>
          </div>
        </div>

        <p :if={@sending_image} class="chat-sending">Sending image...</p>
        <p :if={@error} class="chat-status">{@error}</p>

        <form phx-submit="send" class="chat-form" autocomplete="off">
          <textarea
            name="body"
            rows="2"
            maxlength="1900"
            placeholder="Type a message..."
            aria-label="Message"
            disabled={not sendable?(assigns)}
          ></textarea>
          <button type="submit" disabled={not sendable?(assigns)}>Send</button>
        </form>
      </div>

      <div class="status-bar">
        <p class="status-bar-field chat-host-status">
          <span :if={@active}>
            {tab_name(@conversations, @active)} is {status_label(active_status(assigns))}
            <span class={"chat-presence " <> to_string(active_status(assigns))}>●</span>
          </span>
        </p>
        <p class="status-bar-field chat-connection">
          {if @online, do: "Connected", else: "Not connected"}
        </p>
      </div>
    </div>
    """
  end

  # A message to another visitor goes to whatever window they have open; with
  # none, nothing is listening and it would be lost.
  defp sendable?(%{active: nil}), do: false
  defp sendable?(%{active: @host, online: online}), do: online
  defp sendable?(assigns), do: here?(assigns.buddies, assigns.active)

  defp here?(buddies, id), do: Enum.any?(buddies, &(&1.id == id))

  defp messages(conversations, id), do: conversations[id][:messages] || []
  defp tab_name(conversations, id), do: conversations[id][:name] || id
  defp unread?(conversations, id), do: conversations[id][:unread] == true

  defp author(%{from: :visitor}, _conversations, _active, nickname) do
    case String.trim(nickname) do
      "" -> "you"
      name -> name
    end
  end

  defp author(_message, conversations, active, _nickname), do: tab_name(conversations, active)

  # KLIPY's media host serves real images, so such a link can be shown as one.
  @klipy_image ~r{^https://static\.klipy\.com/\S+$}
  @only_a_link ~r{^https?://\S+$}

  defp inline_image(message) do
    cond do
      message[:image] -> message[:image]
      Regex.match?(@klipy_image, String.trim(message.body)) -> String.trim(message.body)
      true -> nil
    end
  end

  # A message that is only a picture shows the picture alone.
  defp bare_link?(message) do
    inline_image(message) != nil and Regex.match?(@only_a_link, String.trim(message.body || ""))
  end

  # Whoever the open tab belongs to.
  defp active_status(%{active: @host, host_status: status}), do: status

  defp active_status(assigns) do
    case Enum.find(assigns.buddies, &(&1.id == assigns.active)) do
      %{status: status} -> status
      nil -> :offline
    end
  end

  defp status_label(:dnd), do: "busy"
  defp status_label(:unknown), do: "offline"
  defp status_label(status), do: to_string(status)

  # Discord's statuses. I can be in any; visitors are online, away, or offline.
  @groups [{:online, "Online"}, {:away, "Away"}, {:dnd, "Busy"}, {:offline, "Offline"}]

  defp contact_groups(assigns) do
    contacts = contacts(assigns)

    for {status, label} <- @groups,
        matching = Enum.filter(contacts, &(&1.status == status)),
        matching != [],
        do: {status, label, matching}
  end

  defp contacts(assigns) do
    online = MapSet.new(assigns.buddies, & &1.id)

    # Conversations whose other half has gone.
    departed =
      assigns.conversations
      |> Map.drop([@host | MapSet.to_list(online)])
      |> Enum.map(fn {id, conversation} ->
        %{id: id, name: conversation.name, status: :offline}
      end)
      |> Enum.sort_by(& &1.name)

    # Pinned to the top of whichever group I am in.
    [%{id: @host, name: "kfarwell", status: host_group(assigns.host_status)}] ++
      assigns.buddies ++ departed
  end

  defp host_group(:idle), do: :away
  defp host_group(:unknown), do: :offline
  defp host_group(status), do: status

  # --- events ---------------------------------------------------------

  @impl true
  def handle_event("restore", params, socket) do
    socket =
      case params["nickname"] do
        nickname when is_binary(nickname) and nickname != "" ->
          Presence.rename(socket.assigns.visitor_id, nickname)
          assign(socket, nickname: nickname)

        _ ->
          socket
      end

    # Discord holds replies sent while this window was closed; the browser
    # holds older messages and every visitor-to-visitor conversation. Merge.
    socket =
      Enum.reduce(params["conversations"] || %{}, socket, fn {id, messages}, socket ->
        if is_list(messages) and messages != [] do
          socket
          |> ensure_conversation(id, (params["names"] || %{})[id] || id)
          |> merge_messages(id, Enum.map(messages, &normalize/1))
        else
          socket
        end
      end)

    {:noreply, socket}
  end

  def handle_event("set_nickname", %{"nickname" => nickname}, socket) do
    nickname = String.slice(nickname, 0, 60)

    if nickname == socket.assigns.nickname do
      {:noreply, socket}
    else
      # The thread is renamed on their next message; Discord rate-limits it.
      Presence.rename(socket.assigns.visitor_id, nickname)
      {:noreply, socket |> assign(nickname: nickname) |> store()}
    end
  end

  def handle_event("open", %{"peer" => peer}, socket) do
    {:noreply,
     socket
     |> ensure_tab(peer, peer_name(peer))
     |> assign(active: peer)
     |> clear_unread(peer)
     |> retitle()}
  end

  def handle_event("select", %{"peer" => peer}, socket) do
    {:noreply, socket |> assign(active: peer) |> clear_unread(peer) |> retitle()}
  end

  def handle_event("close", %{"peer" => peer}, socket) do
    # The conversation stays in the buddy list and in storage.
    tabs = Enum.reject(socket.assigns.tabs, &(&1 == peer))
    active = if socket.assigns.active == peer, do: List.first(tabs), else: socket.assigns.active

    {:noreply, socket |> assign(tabs: tabs, active: active) |> retitle() |> store()}
  end

  def handle_event(status, _params, socket) when status in ~w(away active) do
    Presence.set_status(socket.assigns.visitor_id, if(status == "away", do: :away, else: :online))
    {:noreply, socket}
  end

  def handle_event("typing", _params, socket) do
    case socket.assigns.active do
      nil ->
        :ok

      @host ->
        Chat.typing(socket.assigns.visitor_id)

      peer ->
        Chat.typing_dm(
          socket.assigns.visitor_id,
          peer,
          Presence.name_for(socket.assigns.visitor_id)
        )
    end

    {:noreply, socket}
  end

  def handle_event("image_chosen", _params, socket), do: {:noreply, socket}

  def handle_event("send", %{"body" => body}, socket) do
    {:noreply, relay(socket, body)}
  end

  def handle_event("send_gif", %{"url" => url}, socket) do
    {:noreply, relay(socket, url)}
  end

  # --- messages in ----------------------------------------------------

  @impl true
  def handle_info({:chat_message, message}, socket) do
    {:noreply,
     socket
     |> assign(typing: Map.delete(socket.assigns.typing, @host))
     |> append(@host, message)
     |> mark_unread(@host)
     |> store()}
  end

  def handle_info({:direct_message, from_id, name, message}, socket) do
    {:noreply,
     socket
     |> assign(typing: Map.delete(socket.assigns.typing, from_id))
     |> ensure_tab(from_id, name)
     |> append(from_id, message)
     |> mark_unread(from_id)
     |> store()}
  end

  # Expire on their own, as Discord's do.
  def handle_info({:typing, id, name}, socket) do
    Process.send_after(self(), {:typing_over, id}, 8_000)
    {:noreply, assign(socket, typing: Map.put(socket.assigns.typing, id, name))}
  end

  def handle_info({:typing_over, id}, socket) do
    {:noreply, assign(socket, typing: Map.delete(socket.assigns.typing, id))}
  end

  def handle_info({:host_status, status}, socket) do
    {:noreply, assign(socket, host_status: status)}
  end

  def handle_info(:refresh_host_status, socket) do
    {:noreply, assign(socket, host_status: Chat.host_status(), online: Chat.available?())}
  end

  def handle_info(%Phoenix.Socket.Broadcast{event: "presence_diff"}, socket) do
    buddies = Presence.buddies(socket.assigns.visitor_id)

    # Relabel open tabs if their owner renamed themselves.
    conversations =
      Enum.reduce(buddies, socket.assigns.conversations, fn buddy, conversations ->
        case conversations[buddy.id] do
          nil -> conversations
          conversation -> Map.put(conversations, buddy.id, %{conversation | name: buddy.name})
        end
      end)

    {:noreply, assign(socket, buddies: buddies, conversations: conversations)}
  end

  # Uploads are automatic; act once the file has arrived.
  defp handle_progress(:image, entry, socket) do
    cond do
      not entry.done? ->
        {:noreply, assign(socket, sending_image: true)}

      # Only Discord can hold a file.
      socket.assigns.active != @host ->
        {:noreply,
         assign(socket, sending_image: false, error: "Images only go to kfarwell, sorry.")}

      true ->
        [{binary, name}] =
          consume_uploaded_entries(socket, :image, fn %{path: path}, entry ->
            {:ok, {File.read!(path), entry.client_name}}
          end)

        visitor_id = socket.assigns.visitor_id
        nickname = socket.assigns.nickname

        # Posting to Discord takes a moment, and this process cannot render
        # while it waits.
        {:noreply,
         socket
         |> assign(sending_image: true, error: nil)
         |> start_async(:image, fn -> Chat.send_image(visitor_id, binary, name, nickname) end)}
    end
  end

  @impl true
  def handle_async(:image, {:ok, {:ok, message}}, socket) do
    {:noreply, socket |> assign(sending_image: false) |> append(@host, message) |> store()}
  end

  def handle_async(:image, _result, socket) do
    {:noreply, assign(socket, sending_image: false, error: "Couldn't send that image.")}
  end

  # --- messages out ---------------------------------------------------

  defp relay(socket, body) do
    case {socket.assigns.active, throttle(socket)} do
      {nil, _} -> socket
      {active, {:ok, socket}} -> dispatch(socket, active, body)
      {_active, {:error, socket}} -> socket
    end
  end

  defp dispatch(socket, @host, body) do
    case Chat.send_message(socket.assigns.visitor_id, body, socket.assigns.nickname) do
      {:ok, message} -> socket |> assign(error: nil) |> append(@host, message) |> store()
      {:error, :empty} -> socket
      {:error, _reason} -> assign(socket, error: "Couldn't send that one. Try again?")
    end
  end

  defp dispatch(socket, peer, body) do
    # The name the buddy list shows, not the one a thread would use.
    from_name = Presence.name_for(socket.assigns.visitor_id)

    case Chat.send_dm(socket.assigns.visitor_id, peer, body, from_name) do
      {:ok, message} -> socket |> assign(error: nil) |> append(peer, message) |> store()
      {:error, :empty} -> socket
      {:error, _reason} -> assign(socket, error: "Couldn't send that one. Try again?")
    end
  end

  # --- conversation bookkeeping ---------------------------------------

  # Reachable from the buddy list, without a tab: on a fresh load only mine is
  # open.
  defp ensure_conversation(socket, id, name) do
    conversations = Map.put_new(socket.assigns.conversations, id, conversation(id, name))

    assign(socket, conversations: conversations)
  end

  defp ensure_tab(socket, id, name) do
    tabs =
      if id in socket.assigns.tabs, do: socket.assigns.tabs, else: socket.assigns.tabs ++ [id]

    socket |> ensure_conversation(id, name) |> assign(tabs: tabs)
  end

  defp put_messages(socket, id, messages) do
    update_conversation(socket, id, &%{&1 | messages: Enum.take(messages, -@keep)})
  end

  defp merge_messages(socket, id, messages) do
    update_conversation(socket, id, fn conversation ->
      merged =
        (conversation.messages ++ messages)
        |> Enum.uniq_by(& &1.id)
        |> Enum.sort_by(& &1.at)
        |> Enum.take(-@keep)

      %{conversation | messages: merged}
    end)
  end

  defp append(socket, id, message) do
    update_conversation(socket, id, fn conversation ->
      # An edit arrives under the id it already has, so it replaces rather than
      # counting as a duplicate.
      messages =
        if Enum.any?(conversation.messages, &(&1.id == message.id)) do
          Enum.map(conversation.messages, &if(&1.id == message.id, do: message, else: &1))
        else
          Enum.take(conversation.messages ++ [message], -@keep)
        end

      %{conversation | messages: messages}
    end)
  end

  defp mark_unread(socket, id) do
    if socket.assigns.active == id,
      do: socket,
      else: update_conversation(socket, id, &%{&1 | unread: true})
  end

  defp clear_unread(socket, id), do: update_conversation(socket, id, &%{&1 | unread: false})

  defp update_conversation(socket, id, fun) do
    case socket.assigns.conversations[id] do
      nil ->
        socket

      conversation ->
        assign(socket,
          conversations: Map.put(socket.assigns.conversations, id, fun.(conversation))
        )
    end
  end

  defp peer_name(@host), do: "kfarwell"
  defp peer_name(peer), do: Presence.name_for(peer)

  # The title bar is outside the LiveView, so the hook sets it.
  defp retitle(socket) do
    title =
      case socket.assigns.active do
        nil -> "Chat"
        active -> "Chat - " <> tab_name(socket.assigns.conversations, active)
      end

    push_event(socket, "chat:title", %{title: title})
  end

  defp store(socket) do
    push_event(socket, "chat:store", %{
      nickname: socket.assigns.nickname,
      conversations: Map.new(socket.assigns.conversations, fn {id, c} -> {id, c.messages} end),
      names: Map.new(socket.assigns.conversations, fn {id, c} -> {id, c.name} end)
    })
  end

  defp throttle(socket) do
    now = System.monotonic_time(:second)
    sends = Enum.filter(socket.assigns.sends, &(now - &1 < @burst_window))

    if length(sends) >= @burst do
      {:error, assign(socket, sends: sends, error: "Slow down a sec!")}
    else
      {:ok, assign(socket, sends: [now | sends])}
    end
  end

  defp normalize(message) do
    %{
      id: to_string(message["id"]),
      from: if(message["from"] == "visitor", do: :visitor, else: :peer),
      body: to_string(message["body"]),
      at: message["at"] || 0,
      image: message["image"]
    }
  end
end

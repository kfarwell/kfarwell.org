defmodule Kfarwell.Chat do
  @moduledoc """
  Bridges site visitors and a Discord forum channel.

  Each visitor is identified by an id in their session cookie and gets one
  forum thread. Messages they send are posted there; replies come back over
  PubSub. Thread names carry the visitor id, so the mapping is rebuilt from
  Discord on boot rather than stored.
  """

  alias Kfarwell.Chat.Threads
  alias Kfarwell.Chat.Webhook
  alias Nostrum.Api.Message
  alias Nostrum.Struct.Channel

  require Logger

  @max_length 1900

  # Message.create/2 takes nostrum's own `:none`; Thread.create_in_forum/2 posts
  # the body verbatim and needs Discord's shape.
  @no_mentions %{parse: []}

  @type message :: %{
          :id => String.t(),
          :from => :visitor | :host | :peer,
          :body => String.t(),
          :at => integer(),
          optional(:image) => String.t() | nil
        }

  @doc "Whether the Discord side is configured and connected."
  @spec available?() :: boolean()
  def available? do
    forum_channel_id() != nil and Kfarwell.Chat.Gateway.connected?()
  end

  @presence_topic "chat:presence"

  @status_key {__MODULE__, :host_status}

  @doc "My Discord status. `:unknown` without the presences intent or a user id."
  @spec host_status() :: :online | :idle | :dnd | :offline | :unknown
  def host_status do
    case :persistent_term.get(@status_key, :none) do
      :none -> status_from_cache()
      status -> status
    end
  end

  @doc """
  The status to show for a presence.

  Discord aggregates across every signed-in client, so a headset left running
  reports online while the desktop is idle. The desktop wins.
  """
  @spec status_of(map()) :: :online | :idle | :dnd | :offline | :unknown
  def status_of(presence) do
    clients = presence[:client_status] || %{}

    normalize_status(clients[:desktop] || presence[:status])
  end

  @doc "Records the status from a presence update, in preference to the cache."
  @spec put_host_status(atom()) :: :ok
  def put_host_status(status), do: :persistent_term.put(@status_key, status)

  # Until the first presence update arrives. The cache is keyed by the ids as
  # Discord sent them, so try both shapes.
  defp status_from_cache do
    with guild_id when is_integer(guild_id) <- guild_id(),
         user_id when is_integer(user_id) <- host_user_id() do
      Enum.find_value(
        [{guild_id, user_id}, {to_string(guild_id), to_string(user_id)}],
        :unknown,
        fn {guild, user} ->
          case Nostrum.Cache.PresenceCache.get(guild, user) do
            {:ok, presence} -> status_of(presence)
            _ -> nil
          end
        end
      )
    else
      _ -> :unknown
    end
  rescue
    # No gateway, no cache table.
    ArgumentError -> :unknown
  end

  @doc """
  Reads a status as an atom or a string.

  Nostrum atomises a payload's keys but not its values.
  """
  @spec normalize_status(atom() | String.t() | nil) ::
          :online | :idle | :dnd | :offline | :unknown
  def normalize_status(status) when is_atom(status) and not is_nil(status),
    do: normalize_status(Atom.to_string(status))

  def normalize_status("online"), do: :online
  def normalize_status("idle"), do: :idle
  def normalize_status("dnd"), do: :dnd
  def normalize_status("offline"), do: :offline
  def normalize_status(_other), do: :unknown

  @spec subscribe_presence() :: :ok | {:error, term()}
  def subscribe_presence, do: Phoenix.PubSub.subscribe(Kfarwell.PubSub, @presence_topic)

  @spec broadcast_presence(atom()) :: :ok | {:error, term()}
  def broadcast_presence(status) do
    Phoenix.PubSub.broadcast(Kfarwell.PubSub, @presence_topic, {:host_status, status})
  end

  @spec host_user_id() :: Nostrum.Struct.User.id() | nil
  def host_user_id, do: Application.get_env(:kfarwell, __MODULE__, [])[:host_user_id]

  @doc "PubSub topic carrying one visitor's incoming messages."
  @spec topic(String.t()) :: String.t()
  def topic(visitor_id), do: "chat:" <> visitor_id

  @spec subscribe(String.t()) :: :ok | {:error, term()}
  def subscribe(visitor_id), do: Phoenix.PubSub.subscribe(Kfarwell.PubSub, topic(visitor_id))

  @spec broadcast(String.t(), message()) :: :ok | {:error, term()}
  def broadcast(visitor_id, message) do
    Phoenix.PubSub.broadcast(Kfarwell.PubSub, topic(visitor_id), {:chat_message, message})
  end

  @doc "Whether an error means the thread has been deleted."
  @spec thread_gone?(term()) :: boolean()
  def thread_gone?(%Nostrum.Error.ApiError{response: %{code: 10_003}}), do: true
  def thread_gone?(_other), do: false

  @doc "Relays a message, opening the visitor's thread if they have none."
  @spec send_message(String.t(), String.t(), String.t() | nil) ::
          {:ok, message()} | {:error, term()}
  def send_message(visitor_id, body, nickname \\ nil) do
    body = body |> String.trim() |> String.slice(0, @max_length)

    cond do
      body == "" -> {:error, :empty}
      not available?() -> {:error, :unavailable}
      true -> do_send(visitor_id, body, nickname)
    end
  end

  # Discord allows two renames per channel per ten minutes, so this runs on
  # sending rather than on every keystroke of the nickname field.
  defp rename_if_needed(visitor_id, thread_id, nickname) do
    name = Threads.thread_name(visitor_id, nickname)

    if name != Threads.name(visitor_id) do
      case Nostrum.Api.Channel.modify(thread_id, %{name: name}) do
        {:ok, _channel} ->
          Threads.put(visitor_id, thread_id, name)
          Logger.info("Renamed thread #{thread_id} to #{name}")

        {:error, reason} ->
          Logger.warning("Could not rename thread #{thread_id}: #{inspect(reason)}")
      end
    end

    :ok
  end

  # Not Threads.nickname/1: that one supplies the word that goes in a thread
  # name, beside the id.
  defp display_name(visitor_id, nickname) do
    case String.trim(nickname || "") do
      "" -> Kfarwell.Presence.default_name(visitor_id)
      name -> name
    end
  end

  # The cache is empty until the gateway is ready, so ask Discord before
  # deciding a visitor is new.
  defp thread_for(visitor_id) do
    case Threads.lookup(visitor_id) do
      {:ok, thread_id} -> {:ok, thread_id}
      :error -> Threads.find_remote(visitor_id)
    end
  end

  defp do_send(visitor_id, body, nickname) do
    result =
      case thread_for(visitor_id) do
        {:ok, thread_id} ->
          rename_if_needed(visitor_id, thread_id, nickname)

          case post(thread_id, visitor_id, body, nickname) do
            {:error, :thread_gone} ->
              Threads.forget(visitor_id)
              open_thread(visitor_id, body, nickname)

            other ->
              other
          end

        :error ->
          open_thread(visitor_id, body, nickname)
      end

    case result do
      {:ok, message} ->
        {:ok, message}

      {:error, reason} ->
        Logger.error("Could not relay visitor message: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp open_thread(visitor_id, body, nickname) do
    name = Threads.thread_name(visitor_id, nickname)

    case Webhook.open(name, body, display_name(visitor_id, nickname)) do
      {:ok, %{channel_id: thread_id}} ->
        Threads.put(visitor_id, thread_id, name)
        Logger.info("Opened chat thread #{thread_id} (#{name}) by webhook")
        {:ok, message(thread_id, :visitor, body)}

      :error ->
        open_thread_as_bot(visitor_id, body, nickname)
    end
  end

  defp open_thread_as_bot(visitor_id, body, nickname) do
    params = %{
      name: Threads.thread_name(visitor_id, nickname),
      auto_archive_duration: 10_080,
      message: %{
        content: signed(body, display_name(visitor_id, nickname)),
        allowed_mentions: @no_mentions
      }
    }

    case Nostrum.Api.Thread.create_in_forum(forum_channel_id(), params) do
      {:ok, %Channel{id: thread_id}} ->
        Threads.put(visitor_id, thread_id, params.name)
        Logger.info("Opened chat thread #{thread_id} (#{params.name})")
        {:ok, message(thread_id, :visitor, body)}

      {:ok, other} ->
        {:error, {:unexpected_response, other}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp post(thread_id, visitor_id, body, nickname) do
    case Webhook.post(thread_id, body, display_name(visitor_id, nickname)) do
      {:ok, %{id: id}} ->
        {:ok, message(id, :visitor, body)}

      {:error, reason} ->
        if thread_gone?(reason),
          do: {:error, :thread_gone},
          else: post_as_bot(thread_id, visitor_id, body, nickname)

      :error ->
        post_as_bot(thread_id, visitor_id, body, nickname)
    end
  end

  defp post_as_bot(thread_id, visitor_id, body, nickname) do
    params = %{
      content: signed(body, display_name(visitor_id, nickname)),
      allowed_mentions: :none
    }

    case Message.create(thread_id, params) do
      {:ok, %{id: id}} ->
        {:ok, message(id, :visitor, body)}

      {:error, reason} ->
        if thread_gone?(reason), do: {:error, :thread_gone}, else: {:error, reason}
    end
  end

  # The bot can only post under its own name, so the message says whose it is.
  defp signed(body, name) do
    "**" <> String.replace(name, "*", "") <> ":** " <> body
  end

  defp unsigned(body), do: String.replace(body, ~r/^\*\*[^*\n]*:\*\* /, "")

  defp message(id, from, body) do
    %{
      id: to_string(id),
      from: from,
      body: body,
      at: System.system_time(:second)
    }
  end

  @doc "Relays an uploaded image, opening the visitor's thread if they have none."
  @spec send_image(String.t(), binary(), String.t(), String.t() | nil) ::
          {:ok, message()} | {:error, term()}
  def send_image(visitor_id, binary, filename, nickname \\ nil) do
    file = %{name: safe_filename(filename), body: binary}

    if available?() do
      case thread_for(visitor_id) do
        {:ok, thread_id} ->
          rename_if_needed(visitor_id, thread_id, nickname)

          case post_file(thread_id, visitor_id, file, nickname) do
            {:error, :thread_gone} ->
              Threads.forget(visitor_id)
              open_thread_with_file(visitor_id, file, nickname)

            other ->
              other
          end

        :error ->
          open_thread_with_file(visitor_id, file, nickname)
      end
    else
      {:error, :unavailable}
    end
  end

  defp post_file(thread_id, visitor_id, file, nickname) do
    case Webhook.post(thread_id, "", display_name(visitor_id, nickname), file) do
      {:ok, message} ->
        {:ok, image_message(message.id, file.name, message)}

      {:error, reason} ->
        if thread_gone?(reason),
          do: {:error, :thread_gone},
          else: post_file_as_bot(thread_id, visitor_id, file, nickname)

      :error ->
        post_file_as_bot(thread_id, visitor_id, file, nickname)
    end
  end

  defp post_file_as_bot(thread_id, visitor_id, file, nickname) do
    params = %{
      content: signed("", display_name(visitor_id, nickname)),
      file: file,
      allowed_mentions: :none
    }

    case Message.create(thread_id, params) do
      {:ok, message} ->
        {:ok, image_message(message.id, file.name, message)}

      {:error, reason} ->
        if thread_gone?(reason), do: {:error, :thread_gone}, else: {:error, reason}
    end
  end

  defp open_thread_with_file(visitor_id, file, nickname) do
    name = Threads.thread_name(visitor_id, nickname)

    case Webhook.open(name, "", display_name(visitor_id, nickname), file) do
      {:ok, %{channel_id: thread_id} = message} ->
        Threads.put(visitor_id, thread_id, name)
        Logger.info("Opened chat thread #{thread_id} (#{name}) by webhook")
        {:ok, image_message(thread_id, file.name, message)}

      _ ->
        open_thread_with_file_as_bot(visitor_id, file, nickname)
    end
  end

  defp open_thread_with_file_as_bot(visitor_id, file, nickname) do
    params = %{
      name: Threads.thread_name(visitor_id, nickname),
      auto_archive_duration: 10_080,
      message: %{
        content: signed("", display_name(visitor_id, nickname)),
        file: file,
        allowed_mentions: @no_mentions
      }
    }

    case Nostrum.Api.Thread.create_in_forum(forum_channel_id(), params) do
      {:ok, %Channel{id: thread_id}} ->
        Threads.put(visitor_id, thread_id, params.name)
        Logger.info("Opened chat thread #{thread_id} (#{params.name})")
        {:ok, image_message(thread_id, file.name, nil)}

      {:ok, other} ->
        {:error, {:unexpected_response, other}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp image_message(id, name, message) do
    id
    |> message(:visitor, name)
    |> Map.put(:image, message && image_url(message))
  end

  @doc """
  The picture a message carries, if any.

  Uploads are attachments; a link to a GIF site becomes an embed once Discord
  has resolved it, and that embed holds the only usable media URL.
  """
  @spec image_url(map()) :: String.t() | nil
  def image_url(message) do
    attachment_url(message) || embed_url(message)
  end

  defp attachment_url(%{attachments: [%{url: url} | _rest]}), do: url
  defp attachment_url(_message), do: nil

  defp embed_url(%{embeds: embeds}) when is_list(embeds) do
    Enum.find_value(embeds, fn embed ->
      case embed do
        %{image: %{url: url}} when is_binary(url) -> url
        %{thumbnail: %{url: url}} when is_binary(url) -> url
        %{video: %{url: url}} when is_binary(url) -> url
        _ -> nil
      end
    end)
  end

  defp embed_url(_message), do: nil

  # The name comes from the visitor's browser.
  defp safe_filename(name) do
    name
    |> Path.basename()
    |> String.replace(~r/[^A-Za-z0-9_.-]/, "_")
    |> String.slice(0, 80)
    |> case do
      "" -> "image.png"
      cleaned -> cleaned
    end
  end

  @doc "Topic for a visitor's direct messages. These never touch Discord."
  @spec dm_topic(String.t()) :: String.t()
  def dm_topic(visitor_id), do: "chat:dm:" <> visitor_id

  @doc "Shows a typing indicator in the visitor's Discord thread."
  @spec typing(String.t()) :: :ok
  def typing(visitor_id) do
    with true <- available?(),
         {:ok, thread_id} <- Threads.lookup(visitor_id) do
      Nostrum.Api.Channel.start_typing(thread_id)
    end

    :ok
  end

  @spec typing_dm(String.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def typing_dm(from_id, to_id, from_name) do
    Phoenix.PubSub.broadcast(Kfarwell.PubSub, dm_topic(to_id), {:typing, from_id, from_name})
  end

  @doc "Tells a visitor's window that I am typing."
  @spec broadcast_typing(String.t()) :: :ok | {:error, term()}
  def broadcast_typing(visitor_id) do
    Phoenix.PubSub.broadcast(
      Kfarwell.PubSub,
      topic(visitor_id),
      {:typing, "kfarwell", "kfarwell"}
    )
  end

  @spec subscribe_dms(String.t()) :: :ok | {:error, term()}
  def subscribe_dms(visitor_id) do
    Phoenix.PubSub.subscribe(Kfarwell.PubSub, dm_topic(visitor_id))
  end

  @spec send_dm(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, message()} | {:error, term()}
  def send_dm(from_id, to_id, body, from_name) do
    body = body |> String.trim() |> String.slice(0, @max_length)

    if body == "" do
      {:error, :empty}
    else
      message = %{
        id: "dm-" <> Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false),
        from: :visitor,
        body: body,
        at: System.system_time(:second)
      }

      Phoenix.PubSub.broadcast(
        Kfarwell.PubSub,
        dm_topic(to_id),
        {:direct_message, from_id, from_name, %{message | from: :peer}}
      )

      {:ok, message}
    end
  end

  @doc """
  Reads a visitor's conversation back out of their Discord thread.

  Discord is the source of truth when it is reachable; the browser keeps its own
  copy for when it is not.
  """
  @spec history(String.t()) :: [message()]
  def history(visitor_id) do
    with true <- available?(),
         {:ok, thread_id} <- thread_for(visitor_id),
         {:ok, messages} <- read_thread(visitor_id, thread_id) do
      messages
      |> Enum.reject(&(&1.content in [nil, ""] and image_url(&1) == nil))
      |> Enum.map(fn message ->
        %{
          id: to_string(message.id),
          from: if(own_message?(message), do: :visitor, else: :host),
          body: if(own_message?(message), do: unsigned(message.content), else: message.content),
          at: DateTime.to_unix(message.timestamp),
          image: image_url(message)
        }
      end)
      |> Enum.sort_by(& &1.at)
    else
      _ -> []
    end
  end

  defp read_thread(visitor_id, thread_id) do
    case Nostrum.Api.Channel.messages(thread_id, 100) do
      {:ok, messages} ->
        {:ok, messages}

      {:error, reason} ->
        if thread_gone?(reason), do: Threads.forget(visitor_id)
        {:error, reason}
    end
  end

  @doc "Whether we posted the message on a visitor's behalf."
  @spec own_message?(map()) :: boolean()
  def own_message?(%{webhook_id: webhook_id}) when webhook_id != nil, do: true
  def own_message?(%{author: %{id: author_id}}), do: author_id == bot_user_id()
  def own_message?(_message), do: false

  @doc "The bot's own user id, once the gateway has told us what it is."
  @spec bot_user_id() :: Nostrum.Struct.User.id() | nil
  def bot_user_id do
    case Nostrum.Cache.Me.get() do
      %{id: id} -> id
      _ -> nil
    end
  end

  @spec forum_channel_id() :: Nostrum.Struct.Channel.id() | nil
  def forum_channel_id, do: Application.get_env(:kfarwell, __MODULE__, [])[:forum_channel_id]

  @spec guild_id() :: Nostrum.Struct.Guild.id() | nil
  def guild_id, do: Application.get_env(:kfarwell, __MODULE__, [])[:guild_id]
end
